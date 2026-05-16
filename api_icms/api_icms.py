"""
API Python para processar ICMS ST usando openpyxl (baseado em Retencao_Autonoma.py)
Esta API recebe modelo Excel e XMLs via upload e retorna planilha gerada
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename
from pathlib import Path
import tempfile
import os
import shutil
from lxml import etree
from html import unescape
from datetime import datetime
from openpyxl import load_workbook
from openpyxl.utils.cell import coordinate_from_string, column_index_from_string
from collections import Counter
import re

app = Flask(__name__)
CORS(app)  # Permitir requisições do frontend

# Configurações
NS = {"nfe": "http://www.portalfiscal.inf.br/nfe"}
GRUPOS = {
    "1,54%.txt": {"cst": {"20"}, "csosn": set()},
    "4%.txt": {"cst": {"00"}, "csosn": set()},
    "7%.txt": {"cst": set(), "csosn": {"101", "102"}},
}
UF_VALIDO = "23"
CFOP_VALIDOS = {"5101", "5102", "5103", "5105", "5910"}
MAPEAMENTO_ABAS_CELULAS = {
    "1,54%.txt": ("Aliquota 1,54%", "D2"),
    "4%.txt": ("Aliquota 4%", "D2"),
    "7%.txt": ("Aliquota 7%", "D2"),
}

# Diretório temporário para processamento
TEMP_DIR = Path(tempfile.gettempdir()) / "icms_api"

def extrair_dados_filtrados(xml_path: Path) -> tuple[str, str, dict[str, list[list[str]]]]:
    """Extrai dados dos XMLs (mesma função do Retencao_Autonoma.py)"""
    try:
        tree = etree.parse(str(xml_path))
        root = tree.getroot()

        inf_nfe = root.find(".//nfe:infNFe", namespaces=NS)
        if inf_nfe is None:
            return "", "", {}

        ide = inf_nfe.find("nfe:ide", namespaces=NS)
        emit = inf_nfe.find("nfe:emit", namespaces=NS)
        dest = inf_nfe.find("nfe:dest", namespaces=NS)

        fornecedor = emit.findtext("nfe:xFant", default="", namespaces=NS)
        razao_social = dest.findtext("nfe:xNome", default="", namespaces=NS)
        razao_social = unescape(razao_social).replace("&", "&")
        dh_emi = ide.findtext("nfe:dhEmi", namespaces=NS)
        data_emi = datetime.strptime(dh_emi[:10], "%Y-%m-%d")
        periodo = data_emi.strftime("%m-%Y")

        uf = ide.findtext("nfe:cUF", namespaces=NS)
        numero_nf = ide.findtext("nfe:cNF", namespaces=NS)
        chave = root.findtext(".//nfe:infProt/nfe:chNFe", namespaces=NS)

        resultados = {nome: [] for nome in GRUPOS}

        for det in inf_nfe.findall("nfe:det", namespaces=NS):
            prod = det.find("nfe:prod", namespaces=NS)
            imposto = det.find("nfe:imposto", namespaces=NS)

            xprod = prod.findtext("nfe:xProd", default="", namespaces=NS)
            cfop = prod.findtext("nfe:CFOP", default="", namespaces=NS)
            vprod = prod.findtext("nfe:vProd", default="0", namespaces=NS)
            ncm = prod.findtext("nfe:NCM", default="", namespaces=NS)

            total = inf_nfe.find("nfe:total", namespaces=NS)
            icms_tot = total.find("nfe:ICMSTot", namespaces=NS) if total is not None else None

            v_frete = icms_tot.findtext("nfe:vFrete", namespaces=NS) if icms_tot is not None else ""
            v_outro = icms_tot.findtext("nfe:vOutro", namespaces=NS) if icms_tot is not None else ""
            v_ipi = imposto.findtext(".//nfe:IPI/nfe:IPITrib/nfe:vIPI", namespaces=NS)

            v_frete = "0" if not v_frete or float(v_frete) == 0 else v_frete
            v_outro = "0" if not v_outro or float(v_outro) == 0 else v_outro
            v_ipi = "0" if not v_ipi or float(v_ipi) == 0 else v_ipi

            cst = ""
            csosn = ""
            for icms in imposto.findall(".//nfe:ICMS", namespaces=NS):
                for child in icms.iterchildren():
                    cst = child.findtext("nfe:CST", namespaces=NS) or ""
                    csosn = child.findtext("nfe:CSOSN", namespaces=NS) or ""
                    if cst or csosn:
                        break
                if cst or csosn:
                    break

            if uf != UF_VALIDO or cfop not in CFOP_VALIDOS:
                continue

            linha = [chave, uf, numero_nf, fornecedor, xprod, ncm, cfop, cst or csosn, v_frete, v_outro, v_ipi, vprod]

            for nome_saida, filtros in GRUPOS.items():
                if (filtros["cst"] and cst in filtros["cst"]) or (filtros["csosn"] and csosn in filtros["csosn"]):
                    resultados[nome_saida].append(linha)

        return razao_social, periodo, resultados

    except Exception as e:
        print(f"Erro ao processar {xml_path.name}: {e}")
        return "", "", {}

def escrever_dados_na_planilha(aba, dados, celula_inicial):
    """Escreve dados na planilha (mesma função do Retencao_Autonoma.py)"""
    from openpyxl.cell.cell import MergedCell

    col_letra, lin_base = coordinate_from_string(celula_inicial)
    col_index = column_index_from_string(col_letra)

    for i, linha in enumerate(dados):
        for j, valor in enumerate(linha):
            row = lin_base + i
            col = col_index + j
            cell = aba.cell(row=row, column=col)

            if isinstance(cell, MergedCell):
                continue

            if j in (8, 9, 10, 11):
                try:
                    cell.value = float(valor.replace(",", "."))
                    cell.number_format = 'R$ #,##0.00'
                except ValueError:
                    cell.value = valor
            else:
                cell.value = valor

@app.route('/api/icms/process', methods=['POST'])
def process_icms():
    """Endpoint para processar ICMS ST"""
    try:
        # Criar diretório temporário
        TEMP_DIR.mkdir(exist_ok=True)
        session_dir = TEMP_DIR / f"session_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
        session_dir.mkdir(exist_ok=True)

        # Receber arquivos
        if 'modelo' not in request.files:
            return jsonify({'error': 'Arquivo modelo não fornecido'}), 400
        
        modelo_file = request.files['modelo']
        xml_files = request.files.getlist('xmls')

        if not xml_files or len(xml_files) == 0:
            return jsonify({'error': 'Nenhum arquivo XML fornecido'}), 400

        # Validar extensão do modelo antes de salvar
        modelo_filename = secure_filename(modelo_file.filename)
        if not modelo_filename.lower().endswith('.xlsx'):
            return jsonify({'error': 'O arquivo modelo deve ser um arquivo Excel (.xlsx)'}), 400

        # Salvar arquivos temporariamente
        modelo_path = session_dir / modelo_filename
        modelo_file.save(str(modelo_path))

        xml_paths = []
        for xml_file in xml_files:
            xml_filename = secure_filename(xml_file.filename)
            if not xml_filename.lower().endswith('.xml'):
                return jsonify({'error': f'Arquivo inválido: "{xml_filename}". Apenas arquivos .xml são aceitos.'}), 400
            xml_path = session_dir / xml_filename
            xml_file.save(str(xml_path))
            xml_paths.append(xml_path)

        # Processar XMLs (mesma lógica do Retencao_Autonoma.py)
        resultados_finais = {nome: [] for nome in GRUPOS}
        razoes_sociais = []
        periodo = ""

        for xml_path in xml_paths:
            razao, data, resultados = extrair_dados_filtrados(xml_path)
            if razao:
                razoes_sociais.append(razao.strip())
            periodo = data or periodo
            for nome, linhas in resultados.items():
                resultados_finais[nome].extend(linhas)

        if not razoes_sociais or not periodo:
            return jsonify({'error': 'Não foi possível extrair a razão social ou a data de apuração dos XMLs.'}), 400

        # Normalizar razão social (mesma lógica do Retencao_Autonoma.py)
        def normalizar(nome):
            nome = nome.upper().strip()
            nome = re.sub(r"[-–—]\s*ME$", "", nome)
            nome = re.sub(r"\s{2,}", " ", nome)
            return nome

        razoes_normalizadas = [normalizar(razao) for razao in razoes_sociais]
        contagem = Counter(razoes_normalizadas)
        razao_social = contagem.most_common(1)[0][0]

        # Carregar e processar workbook (mesma lógica do Retencao_Autonoma.py)
        wb = load_workbook(str(modelo_path))
        if "ICMS ST 1104" not in wb.sheetnames:
            abas_disponiveis = ", ".join(wb.sheetnames)
            return jsonify({
                "error": f"Aba 'ICMS ST 1104' não encontrada na planilha modelo. Abas disponíveis: {abas_disponiveis}"
            }), 400
        aba_icms = wb["ICMS ST 1104"]

        aba_icms["C3"] = razao_social
        aba_icms["C5"] = datetime.strptime(periodo, "%m-%Y")
        aba_icms["C5"].number_format = "mmm-yy"

        for nome_grupo, (nome_aba, celula) in MAPEAMENTO_ABAS_CELULAS.items():
            dados = resultados_finais[nome_grupo]
            if not dados:
                continue
            if nome_aba not in wb.sheetnames:
                continue
            aba_destino = wb[nome_aba]
            escrever_dados_na_planilha(aba_destino, dados, celula)

        # Salvar arquivo gerado (mesmo formato do Retencao_Autonoma.py linha 204)
        # Sanitizar razão social para nome de arquivo (remover caracteres inválidos do Windows)
        import re
        razao_sanitizada = re.sub(r'[<>:"/\\|?*]', '', razao_social)
        # Garantir que o nome seja exatamente como no Python: "ICMS ST {periodo}_{razao_social}.xlsx"
        nome_planilha = f"ICMS ST {periodo}_{razao_sanitizada}.xlsx"
        arquivo_saida = session_dir / nome_planilha
        wb.save(str(arquivo_saida))

        # Retornar arquivo (mesmo formato do Retencao_Autonoma.py)
        # Flask send_file com download_name já envia o nome corretamente no Content-Disposition
        return send_file(
            str(arquivo_saida),
            as_attachment=True,
            download_name=nome_planilha,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )

    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        # Limpar arquivos temporários após um delay (para permitir download)
        # Em produção, usar um sistema de limpeza agendada
        pass

@app.route('/api/icms/health', methods=['GET'])
def health():
    """Health check"""
    return jsonify({'status': 'ok', 'service': 'ICMS ST API'})

if __name__ == '__main__':
    print("🚀 API ICMS ST iniciando...")
    print(f"📁 Diretório temporário: {TEMP_DIR}")
    app.run(debug=True, host='0.0.0.0', port=5000)
