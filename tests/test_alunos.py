"""Verifica a criação e a persistência da estrutura de alunos em banco temporário."""
from contextlib import closing
from datetime import datetime
from pathlib import Path
import sqlite3
import tempfile
import unittest

from servidor import preparar
from alunos import salvar_aluno, alterar_cadastro, listar_alunos, ler_foto, normalizar_foto, ErroCadastro, LIMITE_FOTO
import base64
from io import BytesIO
from PIL import Image


class EstruturaAlunos(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.pasta = Path(self.temp.name)
        self.db, self.codigo = preparar(self.pasta)

    def test_criacao_sem_cadastros_ficticios_e_valores_iniciais(self):
        with closing(sqlite3.connect(self.db)) as con, con:
            self.assertEqual(con.execute('SELECT count(*) FROM alunos').fetchone()[0], 0)
            con.execute('INSERT INTO alunos (id, nome) VALUES (?, ?)', ('aluno-1', 'Aluno de teste'))
            nome, foto, perfil, ativo, criado, atualizado = con.execute(
                'SELECT nome, foto, perfil_acessibilidade, ativo, criado, atualizado FROM alunos').fetchone()
        self.assertEqual((nome, foto, perfil, ativo), ('Aluno de teste', None, 'padrao', 1))
        self.assertIsNotNone(datetime.fromisoformat(criado.replace('Z', '+00:00')).tzinfo)
        self.assertIsNotNone(datetime.fromisoformat(atualizado.replace('Z', '+00:00')).tzinfo)

    def test_reinicializacao_preserva_alunos_pedidos_e_credencial(self):
        with closing(sqlite3.connect(self.db)) as con, con:
            con.execute("INSERT INTO alunos (id,nome,perfil_acessibilidade,ativo) VALUES ('aluno-1','Aluno de teste','baixa_visao',0)")
            con.execute("INSERT INTO pedidos (id,frase,dispositivo,recebido) VALUES ('pedido-1','Água','MVP','2020-01-01T00:00:00+00:00')")
        db, codigo = preparar(self.pasta)
        self.assertEqual(codigo, self.codigo)
        with closing(sqlite3.connect(db)) as con:
            self.assertEqual(con.execute('SELECT nome,perfil_acessibilidade,ativo FROM alunos').fetchone(),
                             ('Aluno de teste','baixa_visao',0))
            self.assertEqual(con.execute('SELECT id FROM pedidos').fetchone()[0], 'pedido-1')

    def test_rejeita_campos_invalidos_e_identificacao_duplicada(self):
        casos = [
            ('', 'Aluno', 'padrao', 1),
            ('invalido', '   ', 'padrao', 1),
            ('invalido', 'a'*121, 'padrao', 1),
            ('invalido', 'Aluno', 'desconhecido', 1),
            ('invalido', 'Aluno', 'padrao', 2),
        ]
        for valores in casos:
            with self.subTest(valores=valores):
                with closing(sqlite3.connect(self.db)) as con, con:
                    with self.assertRaises(sqlite3.IntegrityError):
                        con.execute('INSERT INTO alunos (id,nome,perfil_acessibilidade,ativo) VALUES (?,?,?,?)', valores)
        with closing(sqlite3.connect(self.db)) as con, con:
            con.execute("INSERT INTO alunos (id,nome) VALUES ('unico','Aluno')")
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("INSERT INTO alunos (id,nome) VALUES ('unico','Outro aluno')")

    def dados(self, **campos):
        return dict({'nome':'Aluno fictício','perfil_acessibilidade':'padrao','autorizado':True}, **campos)

    def imagem(self, cor='red', formato='PNG', tamanho=(800,600)):
        saida = BytesIO()
        imagem = Image.new('RGB', tamanho, cor)
        imagem.save(saida, format=formato)
        return base64.b64encode(saida.getvalue()).decode('ascii')

    def test_salvar_reabrir_editar_e_preservar_pedidos(self):
        aluno = salvar_aluno(self.db, self.dados(), 'testedev')
        preparar(self.pasta)
        self.assertEqual(listar_alunos(self.db)[0], aluno)
        self.assertTrue(aluno['autorizado_em'])
        editado = salvar_aluno(self.db, self.dados(id=aluno['id'],versao=aluno['versao'],nome='Outro nome',perfil_acessibilidade='baixa_visao'), 'testedev', editar=True)
        self.assertEqual(editado['nome'], 'Outro nome')
        self.assertEqual(editado['versao'], aluno['versao']+1)
        self.assertEqual(editado['autorizado_em'], aluno['autorizado_em'])

    def test_autorizacao_e_dados_validados_no_servidor(self):
        for campos in ({'autorizado':False},{'autorizado':'sim'},{'nome':'   '},{'nome':'a'*121},{'perfil_acessibilidade':'invalido'}, {'id':'../arquivo'}):
            with self.subTest(campos=campos):
                with self.assertRaises(ErroCadastro):
                    salvar_aluno(self.db, self.dados(**campos), 'testedev')
        self.assertEqual(listar_alunos(self.db), [])

    def test_foto_normalizada_substituida_preservada_e_removida(self):
        aluno = salvar_aluno(self.db, self.dados(foto=self.imagem()), 'testedev')
        token = aluno['foto_url'].split('/')[-1]
        foto = ler_foto(self.db, token)
        with Image.open(BytesIO(foto)) as imagem:
            self.assertEqual(imagem.format, 'JPEG')
            self.assertLessEqual(max(imagem.size),512)
            self.assertFalse(imagem.getexif())
        aluno = salvar_aluno(self.db, self.dados(id=aluno['id'],versao=aluno['versao'],nome='Editado'), 'testedev', editar=True)
        self.assertEqual(aluno['foto_url'], '/api/fotos/'+token)
        aluno = salvar_aluno(self.db, self.dados(id=aluno['id'],versao=aluno['versao'],foto=self.imagem('blue')), 'testedev', editar=True)
        self.assertNotEqual(aluno['foto_url'], '/api/fotos/'+token)
        self.assertIsNone(ler_foto(self.db, token))
        novo_token = aluno['foto_url'].split('/')[-1]
        aluno = salvar_aluno(self.db, self.dados(id=aluno['id'],versao=aluno['versao'],foto=None), 'testedev', editar=True)
        self.assertIsNone(aluno['foto_url'])
        self.assertIsNone(ler_foto(self.db, novo_token))

    def test_fotos_invalidas_e_limites_nao_criam_cadastro(self):
        for foto in ('nao-e-base64', base64.b64encode(b'<svg>foto falsa</svg>').decode(), self.imagem(formato='GIF'), 'a' * (4*((LIMITE_FOTO+2)//3)+1), self.imagem(tamanho=(9000,1))):
            with self.subTest(tamanho=len(foto)):
                with self.assertRaises(ErroCadastro):
                    salvar_aluno(self.db,self.dados(foto=foto),'testedev')
        self.assertEqual(listar_alunos(self.db), [])
        self.assertIsNone(ler_foto(self.db,'../../arquivo'))

    def test_foto_invalida_na_edicao_preserva_cadastro_e_foto(self):
        aluno = salvar_aluno(self.db,self.dados(foto=self.imagem()),'testedev')
        with self.assertRaises(ErroCadastro):
            salvar_aluno(self.db,self.dados(id=aluno['id'],versao=aluno['versao'],nome='Não salvar',foto='invalida'),'testedev',editar=True)
        self.assertEqual(listar_alunos(self.db)[0],aluno)

    def test_desativacao_reativacao_e_exclusao_exigem_confirmacao(self):
        aluno = salvar_aluno(self.db,self.dados(foto=self.imagem()),'testedev')
        with self.assertRaises(ErroCadastro):
            alterar_cadastro(self.db,dict(id=aluno['id'],versao=aluno['versao'],ativo=False))
        inativo = alterar_cadastro(self.db,dict(id=aluno['id'],versao=aluno['versao'],ativo=False,confirmado=True))
        self.assertFalse(inativo['ativo'])
        self.assertEqual(inativo['foto_url'],aluno['foto_url'])
        ativo = alterar_cadastro(self.db,dict(id=inativo['id'],versao=inativo['versao'],ativo=True,confirmado=True))
        self.assertTrue(ativo['ativo'])
        with self.assertRaises(ErroCadastro):
            alterar_cadastro(self.db,dict(id=ativo['id'],versao=ativo['versao'],confirmacao='incorreto'),excluir=True)
        alterar_cadastro(self.db,dict(id=ativo['id'],versao=ativo['versao'],confirmacao=ativo['nome']),excluir=True)
        self.assertEqual(listar_alunos(self.db),[])
        self.assertIsNone(ler_foto(self.db,aluno['foto_url'].split('/')[-1]))

    def test_concorrencia_nao_sobrescreve_edicao_mais_recente(self):
        aluno = salvar_aluno(self.db,self.dados(),'testedev')
        salvar_aluno(self.db,self.dados(id=aluno['id'],versao=1,nome='Nome atualizado'),'testedev',editar=True)
        for operacao in (lambda: salvar_aluno(self.db,self.dados(id=aluno['id'],versao=1,nome='Versão antiga'),'testedev',editar=True),
                         lambda: alterar_cadastro(self.db,dict(id=aluno['id'],versao=1,ativo=False,confirmado=True)),
                         lambda: alterar_cadastro(self.db,dict(id=aluno['id'],versao=1,confirmacao=aluno['nome']),excluir=True)):
            with self.assertRaises(ErroCadastro) as erro:
                operacao()
            self.assertEqual(erro.exception.status,409)
        self.assertEqual(listar_alunos(self.db)[0]['nome'],'Nome atualizado')

    def test_reenvio_cadastro_nao_duplica(self):
        dados = self.dados(id='a'*32)
        aluno = salvar_aluno(self.db,dados,'testedev')
        self.assertEqual(salvar_aluno(self.db,dados,'testedev'),aluno)
        self.assertEqual(len(listar_alunos(self.db)),1)


if __name__ == '__main__':
    unittest.main()
