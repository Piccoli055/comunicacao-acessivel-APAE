import json
from contextlib import closing
from datetime import datetime, timedelta, timezone
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from servidor import criar_servidor, limpar_expirados, preparar
from transporte import Fila


class Fluxo(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.pasta = Path(self.temp.name)
        self.server, self.codigo = criar_servidor(('127.0.0.1', 0), self.pasta)
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def api(self, rota, dados=None, codigo=None):
        req = Request(self.url + rota, data=json.dumps(dados).encode() if dados is not None else None,
                      headers={'X-Codigo': self.codigo if codigo is None else codigo})
        with urlopen(req, timeout=3) as r:
            return json.load(r)

    def test_acesso_e_validacao(self):
        with self.assertRaises(HTTPError) as e:
            self.api('/api/pedidos', codigo='errado')
        self.assertEqual(e.exception.code, 401)
        with self.assertRaises(HTTPError) as e:
            self.api('/api/pedidos', {})
        self.assertEqual(e.exception.code, 400)

    def test_reenvio_nao_duplica_e_tutora_confirma(self):
        pedido = {'id': 'teste-1', 'frase': 'Quero água.', 'dispositivo': 'MVP'}
        self.api('/api/pedidos', pedido)
        self.api('/api/pedidos', pedido)
        pedidos = self.api('/api/pedidos')
        self.assertEqual(len(pedidos), 1)
        self.assertEqual(pedidos[0]['confirmado'], 0)
        self.api('/api/confirmar', {'id': 'teste-1'})
        self.assertEqual(self.api('/api/pedidos')[0]['confirmado'], 1)

    def test_fila_sobrevive_a_falha_e_reabertura(self):
        caminho = self.pasta / 'fila.sqlite3'
        fila = Fila(caminho)
        fila.adicionar('Preciso de ajuda.')
        with self.assertRaises(HTTPError):
            fila.enviar(self.url, 'errado')
        reaberta = Fila(caminho)
        self.assertEqual(len(reaberta.pendentes()), 1)
        reaberta.enviar(self.url, self.codigo)
        self.assertEqual(reaberta.pendentes(), [])
        self.assertEqual(self.api('/api/pedidos')[0]['frase'], 'Preciso de ajuda.')

    def test_estados_sem_regressao(self):
        self.api('/api/pedidos', {'id':'fluxo', 'frase':'Preciso de ajuda.', 'dispositivo':'Sala 1'})
        with self.assertRaises(HTTPError) as e:
            self.api('/api/atender', {'id':'fluxo'})
        self.assertEqual(e.exception.code, 409)
        self.api('/api/confirmar', {'id':'fluxo'})
        self.assertEqual(self.api('/api/pedidos')[0]['estado'], 'recebido')
        self.api('/api/atender', {'id':'fluxo'})
        self.api('/api/confirmar', {'id':'fluxo'})
        self.api('/api/atender', {'id':'fluxo'})
        self.assertEqual(self.api('/api/pedidos')[0]['estado'], 'atendido')
        self.assertEqual(self.api('/api/pedidos')[0]['prioridade'], 'ajuda')

    def test_varios_comunicadores_e_mesma_frase_intencional(self):
        for i, aparelho in enumerate(['Sala 1', 'Sala 2', 'Sala 1']):
            self.api('/api/pedidos', {'id':str(i), 'frase':'Quero água.', 'dispositivo':aparelho})
        lista = self.api('/api/pedidos')
        self.assertEqual(len(lista), 3)
        self.assertEqual({p['dispositivo'] for p in lista}, {'Sala 1', 'Sala 2'})

    def test_exclusao_48h_inclui_pendentes_e_preserva_recentes(self):
        instante = datetime.now(timezone.utc)
        for i, horas in enumerate([49, 48, 47]):
            self.api('/api/pedidos', {'id':str(i), 'frase':'Pedido', 'dispositivo':'MVP'})
        with closing(sqlite3.connect(self.pasta / 'pedidos.sqlite3')) as con, con:
            for i, horas in enumerate([49, 48, 47]):
                con.execute('UPDATE pedidos SET recebido=? WHERE id=?', ((instante-timedelta(hours=horas)).isoformat(),str(i)))
        self.assertEqual(limpar_expirados(self.pasta/'pedidos.sqlite3', instante), 2)
        self.assertEqual([p['id'] for p in self.api('/api/pedidos')], ['2'])
        with self.assertRaises(HTTPError) as e:
            self.api('/api/confirmar', {'id':'0'})
        self.assertEqual(e.exception.code, 404)

    def test_persistencia_apos_reabrir_e_limpeza_na_inicializacao(self):
        self.api('/api/pedidos', {'id':'mantido', 'frase':'Pedido', 'dispositivo':'MVP'})
        self.api('/api/confirmar', {'id':'mantido'})
        self.api('/api/pedidos', {'id':'antigo', 'frase':'Pedido', 'dispositivo':'MVP'})
        with closing(sqlite3.connect(self.pasta/'pedidos.sqlite3')) as con, con:
            con.execute('UPDATE pedidos SET recebido=? WHERE id=?', ((datetime.now(timezone.utc)-timedelta(hours=49)).isoformat(),'antigo'))
        _, codigo = preparar(self.pasta)
        self.assertEqual(codigo, self.codigo)
        lista = self.api('/api/pedidos')
        self.assertEqual(len(lista), 1)
        self.assertEqual(lista[0]['id'], 'mantido')
        self.assertEqual(lista[0]['estado'], 'recebido')

    def test_migracao_preserva_confirmacoes_do_banco_antigo(self):
        pasta = self.pasta / 'antigo'
        pasta.mkdir()
        with closing(sqlite3.connect(pasta/'pedidos.sqlite3')) as con, con:
            con.execute('CREATE TABLE pedidos (id TEXT PRIMARY KEY, frase TEXT, dispositivo TEXT, recebido TEXT, confirmado INTEGER DEFAULT 0)')
            con.execute('INSERT INTO pedidos VALUES (?,?,?,?,?)', ('legado','Oi','MVP',datetime.now(timezone.utc).isoformat(),1))
        db, _ = preparar(pasta)
        with closing(sqlite3.connect(db)) as con:
            self.assertEqual(con.execute('SELECT estado FROM pedidos').fetchone()[0], 'recebido')

    def test_acesso_protege_todas_as_acoes(self):
        for rota, dados in [('/api/config',None), ('/api/confirmar',{'id':'qualquer'}), ('/api/atender',{'id':'qualquer'}), ('/api/pedidos',{'id':'qualquer'})]:
            with self.assertRaises(HTTPError) as e:
                self.api(rota, dados, codigo='errado')
            self.assertEqual(e.exception.code, 401)

    def test_nao_oculta_pendentes_apos_100_pedidos(self):
        with closing(sqlite3.connect(self.pasta/'pedidos.sqlite3')) as con, con:
            con.executemany('INSERT INTO pedidos (id,frase,dispositivo,recebido,atualizado) VALUES (?,?,?,?,?)',
                            [(str(i),'Pedido','MVP',datetime.now(timezone.utc).isoformat(),datetime.now(timezone.utc).isoformat()) for i in range(105)])
        self.assertEqual(len(self.api('/api/pedidos')), 105)


if __name__ == '__main__':
    unittest.main()
