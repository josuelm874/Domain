/* ---------------------------------- Checagem de Transferências ----------------------------------
 *
 * Confere as transferências de mercadoria entre matriz e filiais. A SAÍDA é a fonte de
 * verdade (mesma premissa da comparação NFe|NFCe, onde o SIGA manda): toda nota de saída
 * com CFOP de transferência precisa existir na ENTRADA com CFOP equivalente, mesmo CST e
 * mesmo valor.
 *
 * Regra do CFOP: o primeiro dígito indica o sentido da operação — 5/6/7 saída, 1/2/3
 * entrada. Uma saída 5409 aparece na entrada como 1409 (ou 2409/3409 quando interestadual).
 * A comparação normaliza o dígito de sentido da entrada para o de saída e então exige
 * igualdade do conjunto de CFOPs.
 *
 * O núcleo (`TransfCheck.core`) é puro e testável fora do browser:
 *   node scripts/test-transf-check.mjs
 * ------------------------------------------------------------------------------------------- */
(function (global) {
    'use strict';

    // CFOPs de transferência a rastrear no lado da SAÍDA.
    const CFOPS_TRANSFERENCIA = ['5409', '5152'];
    const TOLERANCIA_VALOR = 0.01;

    // ------------------------------- núcleo puro -------------------------------

    function onlyDigits(v) {
        return String(v == null ? '' : v).replace(/\D/g, '');
    }

    // A célula de CFOP vem em formatos distintos conforme o relatório e o parser:
    //   número 5409 | texto "5409.0" | texto "5.152;5.409" (múltiplos CFOPs na mesma nota,
    //   com ponto de milhar). Normaliza tudo para uma lista de strings de 4 dígitos.
    function normCfops(cell) {
        if (cell === null || cell === undefined || cell === '') return [];
        return String(cell)
            .split(/[;/]/)
            .map((parte) => onlyDigits(parte.trim().replace(/[.,]0+$/, '')).slice(0, 4))
            .filter((c) => c.length === 4);
    }

    // "060" | 60 | "040;060" -> ['040','060']
    function normCsts(cell) {
        if (cell === null || cell === undefined || cell === '') return [];
        return String(cell)
            .split(';')
            .map((p) => onlyDigits(p.trim()))
            .filter(Boolean)
            .map((p) => (p.length < 3 ? p.padStart(3, '0') : p));
    }

    // Aceita number (parser raw) ou texto em locale BR/US. O separador decimal é o último
    // '.' ou ',' que aparecer; o outro é milhar.
    function parseValor(cell) {
        if (typeof cell === 'number') return cell;
        let s = String(cell == null ? '' : cell).replace(/[^\d.,-]/g, '');
        if (!s) return NaN;
        const lastComma = s.lastIndexOf(',');
        const lastDot = s.lastIndexOf('.');
        if (lastComma !== -1 || lastDot !== -1) {
            const decSep = lastComma > lastDot ? ',' : '.';
            const thousSep = decSep === ',' ? '.' : ',';
            s = s.split(thousSep).join('').replace(decSep, '.');
        }
        return parseFloat(s);
    }

    // 1409 -> 5409, 2409 -> 6409, 3409 -> 7409. CFOP já de saída passa intacto.
    function cfopEntradaParaSaida(cfop) {
        const d = cfop.charCodeAt(0) - 48;
        return d >= 1 && d <= 3 ? String(d + 4) + cfop.slice(1) : cfop;
    }

    function mesmoConjunto(a, b) {
        if (a.length !== b.length) return false;
        const sa = a.slice().sort();
        const sb = b.slice().sort();
        return sa.every((v, i) => v === sb[i]);
    }

    function unicos(lista) {
        return Array.from(new Set(lista));
    }

    function ehTransferencia(cfops) {
        return cfops.some((c) => CFOPS_TRANSFERENCIA.indexOf(c) !== -1);
    }

    // Chave/CFOP/CST/valor renderizados no modal já são só dígitos (normalizados acima);
    // o nome do arquivo é a única string arbitrária que chega ao innerHTML.
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    function fmtBRL(n) {
        return isNaN(n) ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Localiza o cabeçalho pelas colunas "Chave", "CFOP" e "Valor". O relatório tem linhas
    // de título/empresa antes do cabeçalho, então varremos as primeiras linhas.
    //
    // CST é OPCIONAL: o relatório de Notas Fiscais Eletrônicas do ERP traz apenas
    // Destinatário/Remetente, CFOPs, Valor Total e Chave Eletrônica. Exigir CST aqui
    // descartava o arquivo inteiro e a tela abria vazia sem explicação. Quando a coluna
    // não existe, `iCst` volta -1 e a conferência de CST simplesmente não acontece.
    function acharCabecalho(matriz) {
        const limite = Math.min(matriz.length, 25);
        for (let r = 0; r < limite; r++) {
            const linha = (matriz[r] || []).map((c) => String(c == null ? '' : c).toLowerCase());
            const iChave = linha.findIndex((c) => c.includes('chave'));
            const iCfop = linha.findIndex((c) => c.includes('cfop'));
            const iCst = linha.findIndex((c) => c.includes('cst'));
            const iValor = linha.findIndex((c) => c.includes('valor'));
            if (iChave !== -1 && iCfop !== -1 && iValor !== -1) {
                return { linha: r, iChave, iCfop, iCst, iValor };
            }
        }
        return null;
    }

    /**
     * @param {Array<{chave,cfops,csts,valor,origem}>} saidaRows
     * @param {Array<{chave,cfops,csts,valor,origem}>} entradaRows
     * @returns {{totalTransferencias:number, faltantes:Array, divergentes:Array, ok:number}}
     */
    function compararTransferencias(saidaRows, entradaRows) {
        const porChave = new Map();
        for (const e of entradaRows) if (!porChave.has(e.chave)) porChave.set(e.chave, e);

        const transferencias = saidaRows.filter((s) => ehTransferencia(s.cfops));
        const faltantes = [];
        const divergentes = [];
        let ok = 0;
        let cstComparado = false;
        // Este relatorio nao traz CST. `temCst` diz se ALGUMA linha trouxe, para a UI nao
        // exibir coluna e mensagem de um campo que nunca existiu nesta conferencia.
        const temCst = saidaRows.some((x) => x.csts.length) || entradaRows.some((x) => x.csts.length);

        for (const s of transferencias) {
            const e = porChave.get(s.chave);
            if (!e) {
                faltantes.push(s);
                continue;
            }
            const cfopsEntradaNormalizados = e.cfops.map(cfopEntradaParaSaida);
            const campos = [];
            if (!mesmoConjunto(cfopsEntradaNormalizados, s.cfops)) {
                campos.push({ campo: 'CFOP', saida: s.cfops.join(' / '), entrada: e.cfops.join(' / ') });
            }
            // CST comparado como conjunto ÚNICO: a coluna repete o CST uma vez por CFOP
            // ("060;060" quando a nota tem 5152+5409), então a cardinalidade só espelha a
            // do CFOP. Deduplicando, o CST só acusa quando o código em si difere — e a
            // consolidação de CFOP na entrada aparece uma vez, na linha de CFOP.
            //
            // Só compara quando os DOIS lados trouxerem CST. Coluna ausente é ausência de
            // evidência, não prova de divergência: acusar CST contra um relatório que não
            // tem a coluna encheria a tela de falso positivo.
            if (s.csts.length && e.csts.length) {
                cstComparado = true;
                if (!mesmoConjunto(unicos(e.csts), unicos(s.csts))) {
                    campos.push({ campo: 'CST', saida: s.csts.join(' / '), entrada: e.csts.join(' / ') });
                }
            }
            if (!(Math.abs(s.valor - e.valor) <= TOLERANCIA_VALOR)) {
                campos.push({ campo: 'Valor', saida: fmtBRL(s.valor), entrada: fmtBRL(e.valor) });
            }
            if (campos.length) divergentes.push({ saida: s, entrada: e, campos });
            else ok++;
        }

        return { totalTransferencias: transferencias.length, faltantes, divergentes, ok, cstComparado, temCst };
    }

    const core = {
        CFOPS_TRANSFERENCIA,
        onlyDigits,
        normCfops,
        normCsts,
        parseValor,
        cfopEntradaParaSaida,
        acharCabecalho,
        ehTransferencia,
        compararTransferencias,
        fmtBRL,
        escapeHtml,
    };

    // Ambiente Node (teste): exporta só o núcleo e para por aqui.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = core;
        return;
    }

    // ------------------------------- leitura das planilhas -------------------------------

    // Devolve { rows, avisos }. Todo motivo para uma nota NÃO entrar na checagem vira um
    // aviso visível no modal — arquivo rejeitado, coluna faltando, linha sem CFOP. Antes
    // isso morria num console.warn e a tela abria vazia como se estivesse tudo certo.
    function lerPlanilha(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const rows = [];
                const avisos = [];
                let totalCanceladas = 0;
                try {
                    const isCsv = /\.csv$/i.test(file.name);
                    const workbook = XLSX.read(e.target.result, { type: isCsv ? 'string' : 'array', raw: true });
                    let canceladas = 0;
                    let semCfopComValor = 0;
                    for (const nome of workbook.SheetNames) {
                        const sheet = workbook.Sheets[nome];
                        if (!sheet['!ref']) continue;
                        const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
                        const cab = acharCabecalho(matriz);
                        if (!cab) {
                            avisos.push(`${file.name} / ${nome}: cabeçalho com Chave, CFOP e Valor não encontrado — aba ignorada.`);
                            continue;
                        }
                        for (let r = cab.linha + 1; r < matriz.length; r++) {
                            const linha = matriz[r] || [];
                            const chave = onlyDigits(linha[cab.iChave]);
                            if (chave.length !== 44) continue;
                            const cfops = normCfops(linha[cab.iCfop]);
                            const valor = parseValor(linha[cab.iValor]);
                            // Nota cancelada: o relatorio mantem a chave e esvazia CFOP e valor.
                            // Fora da checagem por natureza -- e fora de `rows`, senao inflaria a
                            // contagem de notas lidas. Se a entrada de uma transferencia for
                            // cancelada, a saida corretamente aparece como ausente na entrada.
                            if (!cfops.length && isNaN(valor)) { canceladas++; continue; }
                            // Sem CFOP mas COM valor nao e cancelamento -- caso desconhecido, avisa.
                            if (!cfops.length) semCfopComValor++;
                            rows.push({
                                chave,
                                cfops,
                                csts: cab.iCst === -1 ? [] : normCsts(linha[cab.iCst]),
                                valor,
                                origem: file.name,
                            });
                        }
                    }
                    totalCanceladas += canceladas;
                    if (semCfopComValor) avisos.push(`${file.name}: ${semCfopComValor} nota(s) sem CFOP mas com valor — fora da checagem, verificar no ERP.`);
                    if (!rows.length) avisos.push(`${file.name}: nenhuma nota lida.`);
                    console.log(`✅ ${file.name}: ${rows.length} notas lidas${totalCanceladas ? ` (+${totalCanceladas} cancelada[s])` : ''}`);
                } catch (err) {
                    console.error(`❌ Erro ao ler ${file.name}:`, err);
                    avisos.push(`${file.name}: erro ao ler o arquivo (${err && err.message ? err.message : err}).`);
                }
                resolve({ nome: file.name, rows, avisos, canceladas: totalCanceladas });
            };
            reader.onerror = () => {
                console.error(`❌ Falha de leitura: ${file.name}`);
                resolve({ nome: file.name, rows: [], avisos: [`${file.name}: falha de leitura do arquivo.`], canceladas: 0 });
            };
            if (/\.csv$/i.test(file.name)) reader.readAsText(file, 'utf-8');
            else reader.readAsArrayBuffer(file);
        });
    }

    // ------------------------------- interface -------------------------------

    function animarCheck(label, checkSvg) {
        label.style.transition = 'opacity 0.3s ease';
        label.style.opacity = '0';
        setTimeout(() => {
            label.style.display = 'none';
            const path = checkSvg.querySelector('path');
            path.setAttribute('stroke-dashoffset', '-30');
            checkSvg.style.display = 'block';
            setTimeout(() => {
                path.style.transition = 'stroke-dashoffset 0.5s ease-in-out';
                path.setAttribute('stroke-dashoffset', '0');
            }, 50);
        }, 300);
    }

    function caixa(id, titulo, delay) {
        return `
            <div role="button" tabindex="0" aria-label="Selecionar arquivos: ${titulo}" class="dropzone box animate-section" style="animation-delay: ${delay}; height: 300px; position: relative; display: flex; align-items: center; justify-content: center;" id="${id}-box">
                <span class="dropzone__icon" aria-hidden="true"><span class="material-icons-sharp">compare_arrows</span></span>
                <p class="dropzone__title" id="${id}-label">Solte o relatório de ${titulo} aqui</p>
                <p class="dropzone__hint">Relatório de Notas Fiscais Eletrônicas com Chave, CFOP e Valor.</p>
                <div class="dropzone__formats" aria-hidden="true"><span>.xlsx</span><span>.xls</span><span>.csv</span></div>
                <input type="file" id="${id}-file-input" accept=".xls,.xlsx,.csv" multiple hidden>
                <svg id="${id}-check" class="dropzone__check" width="44" height="44" viewBox="0 0 24 24" fill="none" style="display: none;">
                    <path d="M20 6L9 17L4 12" stroke="var(--color-success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="30" stroke-dashoffset="30"/>
                </svg>
            </div>`;
    }

    // ------------------------------- exportação -------------------------------

    // Linhas planas usadas pelos dois exportadores (uma linha por campo divergente,
    // para que a planilha fique filtrável por campo).
    function linhasDoResultado(r) {
        const ausentes = r.faltantes.map((f) => Object.assign(
            { Chave: f.chave, CFOP: f.cfops.join(' / ') },
            r.temCst ? { CST: f.csts.join(' / ') } : null,
            { Valor: f.valor, Arquivo: f.origem }
        ));
        const divergencias = r.divergentes.flatMap((d) =>
            d.campos.map((c) => ({
                Chave: d.saida.chave,
                Campo: c.campo,
                'Saída': c.saida,
                Entrada: c.entrada,
                Arquivo: d.saida.origem,
            }))
        );
        return { ausentes, divergencias };
    }

    function nomeArquivo(ext) {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return `Checagem_Transferencias_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
    }

    function exportarXlsx(r) {
        const { ausentes, divergencias } = linhasDoResultado(r);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(ausentes.length ? ausentes : [{ Chave: 'Nenhuma nota ausente' }]),
            'Ausentes na Entrada'
        );
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(divergencias.length ? divergencias : [{ Chave: 'Nenhuma divergência' }]),
            'Divergencias'
        );
        XLSX.writeFile(wb, nomeArquivo('xlsx'));
    }

    function exportarPdf(r) {
        if (!window.jspdf) {
            alert('Biblioteca de PDF não carregada.');
            return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const margem = 10;
        const alturaPagina = doc.internal.pageSize.height;
        let y = margem + 8;

        const escrever = (texto, tamanho) => {
            if (y > alturaPagina - margem) {
                doc.addPage();
                y = margem + 8;
            }
            doc.setFontSize(tamanho);
            doc.text(texto, margem, y);
            y += tamanho * 0.55 + 2;
        };

        escrever('Checagem de Transferências', 15);
        escrever(`Data: ${new Date().toLocaleString('pt-BR')}`, 9);
        escrever(`${r.totalTransferencias} transferência(s) na saída · ${r.ok} sem divergência`, 9);
        y += 4;

        const { ausentes, divergencias } = linhasDoResultado(r);

        escrever(`Ausentes na Entrada (${r.faltantes.length})`, 12);
        if (!ausentes.length) escrever('Nenhuma nota de saída ausente na entrada.', 9);
        for (const a of ausentes) {
            escrever(`${a.Chave}  CFOP ${a.CFOP}${r.temCst ? `  CST ${a.CST}` : ''}  R$ ${fmtBRL(a.Valor)}  [${a.Arquivo}]`, 8);
        }

        y += 4;
        escrever(`Divergências (${r.divergentes.length})`, 12);
        if (!divergencias.length) escrever(`Nenhuma divergência de CFOP${r.temCst ? ', CST' : ''} ou valor.`, 9);
        for (const d of divergencias) {
            escrever(`${d.Chave}  ${d.Campo}: saída ${d['Saída']} | entrada ${d.Entrada}`, 8);
        }

        doc.save(nomeArquivo('pdf'));
    }

    function createChecagemTransferenciasPage(mainContent) {
        console.log('createChecagemTransferenciasPage chamado');
        mainContent.innerHTML = `
            <div class="page-header">
            <div>
                <h1>Checagem de Transferências</h1>
                <p>Conferir transferências entre matriz e filiais (CFOP, CST e valor).</p>
            </div>
        </div>
            <div class="nfe-cfe-grid" style="display: flex; flex-direction: column; gap: 1.6rem; max-width: 1200px; margin: 0 auto; padding: 2rem;">
                ${caixa('transf-saida', 'Saída', '0s')}
                ${caixa('transf-entrada', 'Entrada', '0.1s')}
            </div>
        `;

        const saidaRows = [];
        const entradaRows = [];
        const avisos = [];
        let canceladas = 0;
        let saidaPronto = false;
        let entradaPronto = false;

        const ligarCaixa = (id, destino, aoTerminar) => {
            const box = document.getElementById(`${id}-box`);
            const input = document.getElementById(`${id}-file-input`);
            const label = document.getElementById(`${id}-label`);
            const check = document.getElementById(`${id}-check`);

            const processar = async (files) => {
                if (!files || !files.length) return;
                label.textContent = 'Lendo...';
                const listas = await Promise.all(Array.from(files).map((f) => lerPlanilha(f)));
                for (const lista of listas) {
                    destino.push(...lista.rows);
                    avisos.push(...lista.avisos);
                    canceladas += lista.canceladas;
                }
                animarCheck(label, check);
                aoTerminar();
            };

            box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('dragover'); });
            box.addEventListener('dragleave', () => box.classList.remove('dragover'));
            box.addEventListener('drop', (e) => {
                e.preventDefault();
                box.classList.remove('dragover');
                processar(e.dataTransfer.files);
            });
            box.addEventListener('click', () => input.click());
            input.addEventListener('change', () => processar(input.files));
        };

        const seAmbos = () => {
            if (saidaPronto && entradaPronto) mostrarModal();
        };

        ligarCaixa('transf-saida', saidaRows, () => { saidaPronto = true; seAmbos(); });
        ligarCaixa('transf-entrada', entradaRows, () => { entradaPronto = true; seAmbos(); });

        function mostrarModal() {
            const r = compararTransferencias(saidaRows, entradaRows);
            console.log('Resultado da checagem de transferências:', r);

            // A chave eletronica carrega o CNPJ do emitente: da para conferir o lote
            // contra a empresa em foco sem abrir nenhum XML.
            const avisoFoco = (typeof window.avisoFocoInline === 'function' && typeof window.cnpjsDeChaves === 'function')
                ? window.avisoFocoInline(window.cnpjsDeChaves(
                    saidaRows.map((x) => x.chave).concat(entradaRows.map((x) => x.chave))))
                : '';

            const modal = document.createElement('div');
            modal.classList.add('modal-overlay');

            // Três estados distintos, antes confundidos em um: nada lido (planilha rejeitada),
            // tudo compatível, e com achados. Sem `nadaLido`, um arquivo recusado abria o
            // modal com "Transferências Compatíveis" — verde em cima de zero conferência.
            const nadaLido = !saidaRows.length || !entradaRows.length;
            const tudoOk = !nadaLido && r.faltantes.length === 0 && r.divergentes.length === 0;
            const semAbas = nadaLido || tudoOk;
            // `.tabs` é position:absolute no main.css — só pode haver UMA barra por modal,
            // e ela também hospeda os botões de exportar (mesmo layout da aba NFe|NFCe).
            const barra = `
                <div class="tabs">
                    <div class="tabs__group" role="tablist">
                        ${semAbas ? '' : `<button type="button" class="tab active" role="tab" aria-selected="true" data-tab="transf-faltantes">
                            Ausentes na Entrada <span class="column-count">(${r.faltantes.length})</span>
                        </button>
                        <button type="button" class="tab" role="tab" aria-selected="false" data-tab="transf-divergentes">
                            Divergências <span class="column-count">(${r.divergentes.length})</span>
                        </button>`}
                    </div>
                    <div class="export-buttons">
                        <button class="export-btn pdf-btn" id="transf-export-pdf" title="Exportar para PDF" aria-label="Exportar para PDF">
                            <span class="material-icons-sharp">picture_as_pdf</span>
                        </button>
                        <button class="export-btn xlsx-btn" id="transf-export-xlsx" title="Exportar para XLSX" aria-label="Exportar para XLSX">
                            <span class="material-icons-sharp">table_view</span>
                        </button>
                    </div>
                </div>`;

            const faltaLado = [!saidaRows.length && 'SAÍDA', !entradaRows.length && 'ENTRADA'].filter(Boolean).join(' e ');
            const corpo = nadaLido
                ? `<p class="success-message" style="color:var(--color-danger);">Nenhuma nota lida da ${faltaLado}</p>
                   <p style="text-align:center;">A checagem não foi executada. Veja os avisos acima para saber qual arquivo foi recusado e por quê.</p>`
                : tudoOk
                ? `<p class="success-message">Transferências Compatíveis</p>
                   <p style="text-align:center;">${r.totalTransferencias} nota(s) de transferência conferida(s).</p>`
                : `
                <div id="transf-faltantes-tab" class="tab-content" style="display:block;">
                    ${r.faltantes.length ? `
                    <table>
                        <thead><tr><th>Chave</th><th>CFOP</th>${r.temCst ? '<th>CST</th>' : ''}<th>Valor</th><th>Arquivo</th></tr></thead>
                        <tbody>
                            ${r.faltantes.map((f) => `
                                <tr>
                                    <td>${f.chave}</td>
                                    <td>${f.cfops.join(' / ')}</td>
                                    ${r.temCst ? `<td>${f.csts.join(' / ')}</td>` : ' + Q + Q + '}
                                    <td>R$ ${fmtBRL(f.valor)}</td>
                                    <td>${escapeHtml(f.origem)}</td>
                                </tr>`).join('')}
                        </tbody>
                    </table>` : '<p class="success-message">Nenhuma nota de saída ausente na entrada</p>'}
                </div>
                <div id="transf-divergentes-tab" class="tab-content" style="display:none;">
                    ${r.divergentes.length ? `
                    <table>
                        <thead><tr><th>Chave</th><th>Campo</th><th>Saída</th><th>Entrada</th></tr></thead>
                        <tbody>
                            ${r.divergentes.map((d) => d.campos.map((c, i) => `
                                <tr>
                                    ${i === 0 ? `<td rowspan="${d.campos.length}">${d.saida.chave}</td>` : ''}
                                    <td>${c.campo}</td>
                                    <td>${c.saida}</td>
                                    <td class="dif">${c.entrada}</td>
                                </tr>`).join('')).join('')}
                        </tbody>
                    </table>` : `<p class="success-message">Nenhuma divergência de CFOP${r.temCst ? ', CST' : ''} ou valor</p>`}
                </div>`;

            // A barra de abas é absoluta no topo do modal; o conteúdo começa abaixo dela.
            // O banner so carrega o que pede acao. Estado normal e esperado -- ausencia de CST
            // neste relatorio, notas canceladas -- vai para a linha de resumo: repetido a cada
            // execucao, treinaria o usuario a ignorar o banner junto com o aviso que importa.
            // Nome de arquivo e a unica string arbitraria que entra aqui -- dai o escapeHtml.
            const bannerAvisos = avisos.length
                ? `<div style="max-width: 900px; margin: 0 auto 1.2rem; padding: 0.9rem 1.1rem; border-left: 4px solid var(--color-warning); background: var(--color-warning-soft); border-radius: 6px; text-align: left;">
                       <strong style="display:block; margin-bottom: 0.4rem;">Avisos de leitura (${avisos.length})</strong>
                       <ul style="margin: 0; padding-left: 1.2rem;">
                           ${avisos.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}
                       </ul>
                   </div>`
                : '';

            modal.innerHTML = `<div class="modal-content">
                ${barra}
                <p style="text-align:center; margin: 4rem 0 0.5rem;">
                    ${r.totalTransferencias} transferência(s) na saída · ${r.ok} conferida(s) sem divergência${canceladas ? ` · ${canceladas} nota(s) cancelada(s) ignorada(s)` : ''}
                </p>
                ${avisoFoco ? `<p style="text-align:center; margin: 0 0 1rem;">${avisoFoco}</p>` : ''}
                ${bannerAvisos}
                ${corpo}
            </div>`;
            document.body.appendChild(modal);

            modal.querySelector('#transf-export-pdf').addEventListener('click', () => exportarPdf(r));
            modal.querySelector('#transf-export-xlsx').addEventListener('click', () => exportarXlsx(r));

            modal.querySelectorAll('.tab').forEach((tab) => {
                tab.addEventListener('click', () => {
                    modal.querySelectorAll('.tab-content').forEach((c) => (c.style.display = 'none'));
                    modal.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
                    document.getElementById(tab.getAttribute('data-tab') + '-tab').style.display = 'block';
                    tab.classList.add('active');
                });
            });

            modal.addEventListener('click', (e) => {
                if (e.target !== modal) return;
                modal.remove();
                createChecagemTransferenciasPage(document.querySelector('#main-content'));
            });
        }
    }

    // `lerPlanilha` fica exposto para o harness poder exercer o caminho de leitura real
    // (cabeçalho + avisos) contra planilhas de verdade, fora do browser.
    global.TransfCheck = { core, lerPlanilha, createChecagemTransferenciasPage };
    global.createChecagemTransferenciasPage = createChecagemTransferenciasPage;
})(typeof globalThis !== 'undefined' ? globalThis : this);
