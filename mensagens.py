"""Mensagens principais do MVP, compartilhadas pelo protótipo e demonstração.

O portal web do aluno usa este catálogo para apresentar categorias e opções.
O protótipo Tkinter mantém as mesmas seis mensagens principais.
"""

MENSAGENS = {
    'agua': {'rotulo':'Água', 'frase':'Quero água.', 'icone':'agua'},
    'banheiro': {'rotulo':'Banheiro', 'frase':'Quero ir ao banheiro.', 'icone':'banheiro'},
    'ajuda': {'rotulo':'Ajuda', 'frase':'Preciso de ajuda.', 'icone':'ajuda'},
    'mal_estar': {'rotulo':'Não estou bem', 'frase':'Não estou bem.', 'icone':'triste'},
    'comida': {'rotulo':'Comida', 'frase':'Estou com fome.', 'icone':'comida'},
    'descanso': {'rotulo':'Descanso', 'frase':'Quero descansar.', 'icone':'descanso'},
}


def opcao_mensagem(identificador):
    mensagem = MENSAGENS[identificador]
    return mensagem['rotulo'], mensagem['frase'], mensagem['icone']


def tipo_mensagem(frase):
    """Reconhece textos completos atuais e anteriores, sem alterar o chamado."""
    import unicodedata
    def normalizar(texto):
        return ' '.join(unicodedata.normalize('NFC',texto).casefold().split()).rstrip('.!?')
    tipos = {normalizar(m['frase']): identificador for identificador,m in MENSAGENS.items()}
    anteriores = {
        'Quero beber água.':'agua', 'Preciso ir ao banheiro.':'banheiro', 'Ir ao banheiro.':'banheiro',
        'Quero comer.':'comida', 'Preciso descansar.':'descanso',
        'Estou feliz.':'feliz', 'Estou triste.':'triste', 'Estou sentindo dor.':'dor',
        'Estou com medo.':'medo', 'Sim.':'sim', 'Não.':'nao', 'Obrigado.':'obrigado',
        'Pode repetir, por favor?':'repetir',
    }
    tipos.update({normalizar(texto):tipo for texto,tipo in anteriores.items()})
    return tipos.get(normalizar(frase),'mensagem') if isinstance(frase,str) else 'mensagem'


OPCOES_ALUNO = {
    **{identificador:dict(mensagem,icone=identificador) for identificador,mensagem in MENSAGENS.items()},
    'feliz': {'rotulo':'Feliz','frase':'Estou feliz.','icone':'feliz'},
    'triste': {'rotulo':'Triste','frase':'Estou triste.','icone':'triste'},
    'dor': {'rotulo':'Dor','frase':'Estou sentindo dor.','icone':'dor'},
    'medo': {'rotulo':'Medo','frase':'Estou com medo.','icone':'medo'},
    'sim': {'rotulo':'Sim','frase':'Sim.','icone':'sim'},
    'nao': {'rotulo':'Não','frase':'Não.','icone':'nao'},
    'obrigado': {'rotulo':'Obrigado','frase':'Obrigado.','icone':'obrigado'},
    'repetir': {'rotulo':'De novo','frase':'Pode repetir, por favor?','icone':'repetir'},
}


def catalogo_aluno():
    """Dados de apresentação; selecionar uma opção ainda não envia pedidos."""
    def mensagem(identificador):
        return dict(OPCOES_ALUNO[identificador],id=identificador)
    grupos = [
        ('necessidades','Necessidades','Água, comida, banheiro e descanso.','agua',('agua','comida','banheiro','descanso')),
        ('sentimentos','Sentimentos','Como você está se sentindo?','feliz',('mal_estar','feliz','triste','dor','medo')),
        ('conversar','Conversar','Responder, agradecer ou pedir para repetir.','repetir',('sim','nao','obrigado','repetir')),
    ]
    return {'categorias':[
        {'id':identificador,'rotulo':rotulo,'descricao':descricao,'icone':icone,
         'mensagens':[mensagem(chave) for chave in opcoes]}
        for identificador,rotulo,descricao,icone,opcoes in grupos
    ],'ajuda':mensagem('ajuda')}
