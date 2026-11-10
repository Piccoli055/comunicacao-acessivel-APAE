from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

from alunos import salvar_aluno, alterar_cadastro, ErroCadastro
from comunicadores import listar_comunicadores, salvar_vinculo
from servidor import preparar


class Vinculos(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.pasta = Path(self.temp.name)
        self.db, _ = preparar(self.pasta)
        self.ana = salvar_aluno(self.db, {'nome':'Ana fictícia','autorizado':True}, 'testedev')
        self.bruno = salvar_aluno(self.db, {'nome':'Bruno fictício','autorizado':True}, 'testedev')

    def vincular(self, aluno, dispositivo='Comunicador 01', versao=0):
        return salvar_vinculo(self.db, {'dispositivo':dispositivo,'aluno_id':aluno,'versao':versao})

    def test_vinculo_persiste_apos_reabrir(self):
        self.assertEqual(listar_comunicadores(self.db), [])
        self.vincular(self.ana['id'])
        preparar(self.pasta)
        lista = listar_comunicadores(self.db)
        self.assertEqual(len(lista),1)
        self.assertEqual((lista[0]['dispositivo'],lista[0]['aluno_id'],lista[0]['aluno_nome'],lista[0]['aluno_ativo'],lista[0]['versao']),
                         ('Comunicador 01',self.ana['id'],'Ana fictícia',1,1))

    def test_troca_remove_e_permite_varios_aparelhos_para_um_aluno(self):
        self.vincular(self.ana['id'])
        self.vincular(self.ana['id'],'Comunicador 02')
        self.vincular(self.bruno['id'],versao=1)
        lista = listar_comunicadores(self.db)
        self.assertEqual([r['aluno_id'] for r in lista],[self.bruno['id'],self.ana['id']])
        self.vincular(None,versao=2)
        self.assertIsNone(listar_comunicadores(self.db)[0]['aluno_id'])
        self.assertEqual(len(listar_comunicadores(self.db)),2)

    def test_recusa_aluno_inativo_ausente_e_dados_invalidos(self):
        alterar_cadastro(self.db,dict(id=self.ana['id'],versao=1,ativo=False,confirmado=True))
        for aluno, status in ((self.ana['id'],409),('inexistente',404)):
            with self.assertRaises(ErroCadastro) as erro:
                self.vincular(aluno)
            self.assertEqual(erro.exception.status,status)
        for dados in ({'dispositivo':'   ','aluno_id':None,'versao':0},
                      {'dispositivo':'a'*81,'aluno_id':None,'versao':0},
                      {'dispositivo':'MVP','aluno_id':True,'versao':0},
                      {'dispositivo':'MVP','versao':0},
                      {'dispositivo':'MVP','aluno_id':None,'versao':True}):
            with self.subTest(dados=dados), self.assertRaises(ErroCadastro):
                salvar_vinculo(self.db,dados)
        self.assertEqual(listar_comunicadores(self.db),[])

    def test_conflito_nao_sobrescreve_vinculo(self):
        self.vincular(self.ana['id'])
        with self.assertRaises(ErroCadastro) as erro:
            self.vincular(self.bruno['id'],versao=0)
        self.assertEqual(erro.exception.status,409)
        self.assertEqual(listar_comunicadores(self.db)[0]['aluno_id'],self.ana['id'])

    def test_comunicadores_observados_nao_alteram_chamados(self):
        with closing(sqlite3.connect(self.db)) as con, con:
            con.execute("INSERT INTO pedidos (id,frase,dispositivo,recebido) VALUES ('p1','Água','MVP','2026-11-10T00:00:00+00:00')")
            original = con.execute('SELECT * FROM pedidos').fetchone()
        self.assertEqual(listar_comunicadores(self.db)[0]['versao'],0)
        self.vincular(self.ana['id'],'MVP')
        with closing(sqlite3.connect(self.db)) as con:
            self.assertEqual(con.execute('SELECT * FROM pedidos').fetchone(),original)

    def test_desativacao_mantem_referencia_e_exclusao_remove_identificacao(self):
        self.vincular(self.ana['id'])
        inativa = alterar_cadastro(self.db,dict(id=self.ana['id'],versao=1,ativo=False,confirmado=True))
        self.assertEqual(listar_comunicadores(self.db)[0]['aluno_ativo'],0)
        alterar_cadastro(self.db,dict(id=inativa['id'],versao=inativa['versao'],confirmacao=inativa['nome']),excluir=True)
        comunicador = listar_comunicadores(self.db)[0]
        self.assertIsNone(comunicador['aluno_id'])
        self.assertIsNone(comunicador['aluno_nome'])
        self.assertEqual(comunicador['versao'],2)


if __name__ == '__main__':
    unittest.main()
