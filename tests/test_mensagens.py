import unittest
from pathlib import Path
from xml.etree import ElementTree
from mensagens import MENSAGENS, tipo_mensagem


class Pictogramas(unittest.TestCase):
    def test_tipos_atuais_e_anteriores_tem_desenho_local(self):
        raiz = ElementTree.parse(Path(__file__).resolve().parent.parent/'pictogramas.svg')
        ids = {no.attrib['id'] for no in raiz.findall('.//{http://www.w3.org/2000/svg}symbol')}
        for identificador,mensagem in MENSAGENS.items():
            self.assertEqual(tipo_mensagem(mensagem['frase']),identificador)
            self.assertIn(identificador,ids)
        for texto,tipo in [('Quero beber água.','agua'),('Preciso ir ao banheiro.','banheiro'),
                           ('Quero comer.','comida'),('Preciso descansar.','descanso'),
                           ('Não estou bem.','mal_estar'),('Estou sentindo dor.','dor')]:
            with self.subTest(texto=texto):
                self.assertEqual(tipo_mensagem(texto),tipo)
                self.assertIn(tipo,ids)
        self.assertIn('mensagem',ids)

    def test_texto_desconhecido_nao_recebe_classificacao_por_palavra_solta(self):
        self.assertEqual(tipo_mensagem('Quero água para lavar as mãos.'),'mensagem')
        self.assertEqual(tipo_mensagem('<script>alert(1)</script>'),'mensagem')
        self.assertEqual(tipo_mensagem(None),'mensagem')
        self.assertEqual(tipo_mensagem('  QUERO   ÁGUA!  '),'agua')


if __name__ == '__main__':
    unittest.main()
