/**
 * Mini zip-writer SEM dependências externas.
 *
 * Por que existir: o worker precisa montar ZIPs (NFCe: 1 por empresa; DIRBI:
 * planilhas por empresa) e tem que continuar empacotável como .exe (pkg/bun)
 * sem node_modules. Em vez de puxar `jszip`/`archiver`, usamos só o `zlib`
 * nativo do Node (DEFLATE) + a construção manual do formato ZIP (PKZIP APPNOTE).
 *
 * Escopo: arquivos < 4GB por entrada e ZIP final < 4GB (formato clássico, sem
 * ZIP64). Suficiente para NFCe (ZIP pequeno por empresa). Para DIRBI (~2GB) os
 * arquivos são planilhas por empresa — cada uma bem abaixo de 4GB; o ZIP de
 * saída agrupa poucas e fica longe do teto. Se um dia passar de 4GB, migrar p/
 * ZIP64 (TODO marcado).
 *
 * CRC-32 é implementado via tabela: `zlib.crc32` só existe a partir do Node 22
 * e o worker tem `engines.node >= 18`.
 */
'use strict';

const zlib = require('zlib');

// ---- CRC-32 (polinômio padrão 0xEDB88320), tabela pré-computada uma vez ----
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// Data/hora DOS fixa (2026-01-01 00:00) — evita depender do relógio e mantém
// os ZIPs determinísticos (útil em teste). O Fortes/Windows não se importam.
const DOS_TIME = 0;                       // 00:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // ano 2026, mês 1, dia 1

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;                 // nomes de arquivo em UTF-8
const METHOD_DEFLATE = 8;
const METHOD_STORE = 0;

/**
 * Escritor incremental. Acumula os blocos em memória (Buffer[]) e fecha com
 * `end()` devolvendo o Buffer final do .zip. Reutilizável por NFCe e DIRBI.
 */
class ZipWriter {
    constructor() {
        this._chunks = [];      // blocos de dados (local headers + payloads)
        this._central = [];     // registros do diretório central
        this._offset = 0;       // offset corrente = tamanho do .zip até agora
        this._count = 0;
    }

    /**
     * Adiciona uma entrada. `data` aceita string (vira UTF-8) ou Buffer.
     * Comprime com DEFLATE; se o resultado não diminuir, grava STORE.
     */
    add(name, data) {
        const content = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
        const nameBuf = Buffer.from(name, 'utf8');
        const crc = crc32(content);
        const uncompressedSize = content.length;

        let method = METHOD_DEFLATE;
        let compressed = uncompressedSize ? zlib.deflateRawSync(content) : Buffer.alloc(0);
        if (compressed.length >= uncompressedSize) {
            method = METHOD_STORE;
            compressed = content;
        }
        const compressedSize = compressed.length;

        const local = Buffer.alloc(30);
        local.writeUInt32LE(SIG_LOCAL, 0);
        local.writeUInt16LE(20, 4);                 // version needed
        local.writeUInt16LE(FLAG_UTF8, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(DOS_TIME, 10);
        local.writeUInt16LE(DOS_DATE, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressedSize, 18);
        local.writeUInt32LE(uncompressedSize, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);                 // extra length
        this._chunks.push(local, nameBuf, compressed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(SIG_CENTRAL, 0);
        central.writeUInt16LE(20, 4);               // version made by
        central.writeUInt16LE(20, 6);               // version needed
        central.writeUInt16LE(FLAG_UTF8, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(DOS_TIME, 12);
        central.writeUInt16LE(DOS_DATE, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressedSize, 20);
        central.writeUInt32LE(uncompressedSize, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30);               // extra length
        central.writeUInt16LE(0, 32);               // comment length
        central.writeUInt16LE(0, 34);               // disk number start
        central.writeUInt16LE(0, 36);               // internal attrs
        central.writeUInt32LE(0, 38);               // external attrs
        central.writeUInt32LE(this._offset, 42);    // offset do local header
        this._central.push(Buffer.concat([central, nameBuf]));

        this._offset += local.length + nameBuf.length + compressedSize;
        this._count++;
        return this;
    }

    /** Fecha e devolve o Buffer completo do .zip. */
    end() {
        const centralDir = Buffer.concat(this._central);
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(SIG_EOCD, 0);
        eocd.writeUInt16LE(0, 4);                   // disk number
        eocd.writeUInt16LE(0, 6);                   // disk with central dir
        eocd.writeUInt16LE(this._count, 8);         // entries this disk
        eocd.writeUInt16LE(this._count, 10);        // total entries
        eocd.writeUInt32LE(centralDir.length, 12);  // central dir size
        eocd.writeUInt32LE(this._offset, 16);       // central dir offset
        eocd.writeUInt16LE(0, 20);                  // comment length
        return Buffer.concat([...this._chunks, centralDir, eocd]);
    }

    get count() { return this._count; }
}

/** Conveniência: monta um .zip de uma vez a partir de [{name, data}]. */
function buildZip(entries) {
    const w = new ZipWriter();
    for (const e of entries) w.add(e.name, e.data);
    return w.end();
}

module.exports = { ZipWriter, buildZip, crc32, METHOD_STORE, METHOD_DEFLATE };
