"""Fila persistente e envio sem duplicação."""
import json
from contextlib import contextmanager
import sqlite3
import uuid
from pathlib import Path
from urllib.request import Request, urlopen


class Fila:
    def __init__(self, caminho):
        self.caminho = Path(caminho)
        self.caminho.parent.mkdir(parents=True, exist_ok=True)
        with self.conectar() as con:
            con.execute('CREATE TABLE IF NOT EXISTS fila (id TEXT PRIMARY KEY, frase TEXT NOT NULL, dispositivo TEXT NOT NULL)')

    @contextmanager
    def conectar(self):
        con = sqlite3.connect(self.caminho, timeout=10)
        try:
            with con:
                yield con
        finally:
            con.close()

    def adicionar(self, frase, dispositivo='MVP'):
        identificador = str(uuid.uuid4())
        with self.conectar() as con:
            con.execute('INSERT INTO fila VALUES (?, ?, ?)', (identificador, frase, dispositivo))
        return identificador

    def pendentes(self):
        with self.conectar() as con:
            return [dict(zip(('id', 'frase', 'dispositivo'), row)) for row in con.execute('SELECT id, frase, dispositivo FROM fila ORDER BY rowid')]

    def enviar(self, servidor, codigo):
        for pedido in self.pendentes():
            req = Request(servidor.rstrip('/') + '/api/pedidos',
                          data=json.dumps(pedido).encode('utf-8'),
                          headers={'Content-Type': 'application/json', 'X-Codigo': codigo})
            with urlopen(req, timeout=4) as resposta:
                if not json.load(resposta).get('ok'):
                    raise ValueError('Servidor não confirmou o pedido.')
            with self.conectar() as con:
                con.execute('DELETE FROM fila WHERE id=?', (pedido['id'],))
