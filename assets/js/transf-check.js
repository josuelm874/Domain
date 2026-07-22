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
            if (!mesmoConjunto(unicos(e.csts), unicos(s.csts))) {
                campos.push({ campo: 'CST', saida: s.csts.join(' / '), entrada: e.csts.join(' / ') });
            }
            if (!(Math.abs(s.valor - e.valor) <= TOLERANCIA_VALOR)) {
                campos.push({ campo: 'Valor', saida: fmtBRL(s.valor), entrada: fmtBRL(e.valor) });
            }
            if (campos.length) divergentes.push({ saida: s, entrada: e, campos });
            else ok++;
        }

        return { totalTransferencias: transferencias.length, faltantes, divergentes, ok };
    }

    const core = {
        CFOPS_TRANSFERENCIA,
        onlyDigits,
        normCfops,
        normCsts,
        parseValor,
        cfopEntradaParaSaida,
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

    // Localiza o cabeçalho pelas colunas "Chave", "CFOP", "CST" e "Valor". O relatório tem
    // linhas de título/empresa antes do cabeçalho, então varremos as primeiras linhas.
    function acharCabecalho(matriz) {
        const limite = Math.min(matriz.length, 25);
        for (let r = 0; r < limite; r++) {
            const linha = (matriz[r] || []).map((c) => String(c == null ? '' : c).toLowerCase());
            const iChave = linha.findIndex((c) => c.includes('chave'));
            const iCfop = linha.findIndex((c) => c.includes('cfop'));
            const iCst = linha.findIndex((c) => c.includes('cst'));
            const iValor = linha.findIndex((c) => c.includes('valor'));
            if (iChave !== -1 && iCfop !== -1 && iCst !== -1 && iValor !== -1) {
                return { linha: r, iChave, iCfop, iCst, iValor };
            }
        }
        return null;
    }

    function lerPlanilha(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const rows = [];
                try {
                    const isCsv = /\.csv$/i.test(file.name);
                    const workbook = XLSX.read(e.target.result, { type: isCsv ? 'string' : 'array', raw: true });
                    for (const nome of workbook.SheetNames) {
                        const sheet = workbook.Sheets[nome];
                        if (!sheet['!ref']) continue;
                        const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
                        const cab = acharCabecalho(matriz);
                        if (!cab) {
                            console.warn(`⚠️ Cabeçalho (Chave/CFOP/CST/Valor) não encontrado em ${file.name} / ${nome}`);
                            continue;
                        }
                        for (let r = cab.linha + 1; r < matriz.length; r++) {
                            const linha = matriz[r] || [];
                            const chave = onlyDigits(linha[cab.iChave]);
                            if (chave.length !== 44) continue;
                            rows.push({
                                chave,
                                cfops: normCfops(linha[cab.iCfop]),
                                csts: normCsts(linha[cab.iCst]),
                                valor: parseValor(linha[cab.iValor]),
                                origem: file.name,
                            });
                        }
                    }
                    console.log(`✅ ${file.name}: ${rows.length} notas lidas`);
                } catch (err) {
                    console.error(`❌ Erro ao ler ${file.name}:`, err);
                }
                resolve(rows);
            };
            reader.onerror = () => {
                console.error(`❌ Falha de leitura: ${file.name}`);
                resolve([]);
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
            <div class="box animate-section" style="animation-delay: ${delay}; width: 100%; max-width: 800px; height: 300px; margin: 0 auto; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding); position: relative; cursor: pointer; display: flex; align-items: center; justify-content: center;" id="${id}-box">
                <span class="box-label" id="${id}-label">${titulo}</span>
                <svg id="${id}-check" width="60" height="60" viewBox="0 0 24 24" fill="none" style="display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);">
                    <path d="M20 6L9 17L4 12" stroke="#00ff00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="30" stroke-dashoffset="30"/>
                </svg>
                <input type="file" id="${id}-file-input" accept=".xls,.xlsx,.csv" multiple style="display: none;">
            </div>`;
    }

    // ------------------------------- exportação -------------------------------

    // Linhas planas usadas pelos dois exportadores (uma linha por campo divergente,
    // para que a planilha fique filtrável por campo).
    function linhasDoResultado(r) {
        const ausentes = r.faltantes.map((f) => ({
            Chave: f.chave,
            CFOP: f.cfops.join(' / '),
            CST: f.csts.join(' / '),
            Valor: f.valor,
            Arquivo: f.origem,
        }));
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
            escrever(`${a.Chave}  CFOP ${a.CFOP}  CST ${a.CST}  R$ ${fmtBRL(a.Valor)}  [${a.Arquivo}]`, 8);
        }

        y += 4;
        escrever(`Divergências (${r.divergentes.length})`, 12);
        if (!divergencias.length) escrever('Nenhuma divergência de CFOP, CST ou valor.', 9);
        for (const d of divergencias) {
            escrever(`${d.Chave}  ${d.Campo}: saída ${d['Saída']} | entrada ${d.Entrada}`, 8);
        }

        doc.save(nomeArquivo('pdf'));
    }

    function createChecagemTransferenciasPage(mainContent) {
        console.log('createChecagemTransferenciasPage chamado');
        mainContent.innerHTML = `
            <h1>Checagem de Transferências</h1>
            <div class="nfe-cfe-grid" style="display: flex; flex-direction: column; gap: 1.6rem; max-width: 1200px; margin: 0 auto; padding: 2rem;">
                ${caixa('transf-saida', 'Saída', '0s')}
                ${caixa('transf-entrada', 'Entrada', '0.1s')}
            </div>
        `;

        const saidaRows = [];
        const entradaRows = [];
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
                for (const lista of listas) destino.push(...lista);
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

            const modal = document.createElement('div');
            modal.classList.add('modal-overlay');

            const tudoOk = r.faltantes.length === 0 && r.divergentes.length === 0;
            // `.tabs` é position:absolute no main.css — só pode haver UMA barra por modal,
            // e ela também hospeda os botões de exportar (mesmo layout da aba NFe|NFCe).
            const barra = `
                <div class="tabs">
                    ${tudoOk ? '<span></span>' : `<div class="tab active" data-tab="transf-faltantes">
                        Ausentes na Entrada <span class="column-count">(${r.faltantes.length})</span>
                    </div>`}
                    <div class="export-buttons">
                        <button class="export-btn pdf-btn" id="transf-export-pdf" title="Exportar para PDF">
                            <img width="24" height="24" src="https://img.icons8.com/fluency/48/pdf--v1.png" alt="PDF"/>
                        </button>
                        <button class="export-btn xlsx-btn" id="transf-export-xlsx" title="Exportar para XLSX">
                            <img width="24" height="24" src="https://img.icons8.com/color/48/microsoft-excel-2019--v1.png" alt="XLSX"/>
                        </button>
                    </div>
                    ${tudoOk ? '<span></span>' : `<div class="tab" data-tab="transf-divergentes">
                        Divergências <span class="column-count">(${r.divergentes.length})</span>
                    </div>`}
                </div>`;

            const corpo = tudoOk
                ? `<p class="success-message">Transferências Compatíveis</p>
                   <p style="text-align:center;">${r.totalTransferencias} nota(s) de transferência conferida(s).</p>`
                : `
                <div id="transf-faltantes-tab" class="tab-content" style="display:block;">
                    ${r.faltantes.length ? `
                    <table>
                        <thead><tr><th>Chave</th><th>CFOP</th><th>CST</th><th>Valor</th><th>Arquivo</th></tr></thead>
                        <tbody>
                            ${r.faltantes.map((f) => `
                                <tr>
                                    <td>${f.chave}</td>
                                    <td>${f.cfops.join(' / ')}</td>
                                    <td>${f.csts.join(' / ')}</td>
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
                    </table>` : '<p class="success-message">Nenhuma divergência de CFOP, CST ou valor</p>'}
                </div>`;

            // A barra de abas é absoluta no topo do modal; o conteúdo começa abaixo dela.
            modal.innerHTML = `<div class="modal-content">
                ${barra}
                <p style="text-align:center; margin: 4rem 0 1rem;">
                    ${r.totalTransferencias} transferência(s) na saída · ${r.ok} conferida(s) sem divergência
                </p>
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

    global.TransfCheck = { core, createChecagemTransferenciasPage };
    global.createChecagemTransferenciasPage = createChecagemTransferenciasPage;
})(typeof globalThis !== 'undefined' ? globalThis : this);
