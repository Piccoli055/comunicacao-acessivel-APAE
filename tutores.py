"""Cadastro administrativo, responsabilidade por alunos e autorização de pedidos."""
from contextlib import closing
import hashlib
import secrets
import sqlite3
import uuid
from acesso import ITERACOES,CODIGO_DEMO,normalizar_usuario,ErroAcesso
from alunos import ErroCadastro


def preparar_tutores(db):
    with closing(sqlite3.connect(db,timeout=10)) as con, con:
        con.execute('CREATE TABLE IF NOT EXISTS tutores_alunos (aluno_id TEXT PRIMARY KEY,tutor_id TEXT NOT NULL)')
        con.execute('CREATE TABLE IF NOT EXISTS pedidos_tutores (pedido_id TEXT NOT NULL,tutor_id TEXT NOT NULL,tutor_nome TEXT NOT NULL,PRIMARY KEY(pedido_id,tutor_id))')
        if 'origem' not in {r[1] for r in con.execute('PRAGMA table_info(pedidos_tutores)')}:
            con.execute("ALTER TABLE pedidos_tutores ADD COLUMN origem TEXT NOT NULL DEFAULT 'responsavel'")


def exigir_administrador(perfil):
    if not perfil:
        raise ErroAcesso('Entre novamente para continuar.',401)
    if perfil.get('tutor_id'):
        raise ErroAcesso('Somente o acesso administrativo pode gerenciar tutores.',403)


def registro(con,identificador):
    row=con.execute('SELECT id,nome,usuario,ativo,versao FROM tutores WHERE id=?',(identificador,)).fetchone()
    if row is None:raise ErroCadastro('Tutor não encontrado.',404)
    return dict(zip(('id','nome','usuario','ativo','versao'),(row[0],row[1],row[2],bool(row[3]),row[4])),alunos=[r[0] for r in con.execute('SELECT aluno_id FROM tutores_alunos WHERE tutor_id=? ORDER BY aluno_id',(identificador,))])


def listar_tutores(db,perfil):
    exigir_administrador(perfil)
    with closing(sqlite3.connect(db,timeout=10)) as con:
        return [registro(con,r[0]) for r in con.execute('SELECT id FROM tutores WHERE cnpj=? ORDER BY nome COLLATE NOCASE,id',(perfil['cnpj'],)).fetchall()]


def tutor_vinculado(con,aluno_id):
    return con.execute("""SELECT t.id,t.nome,t.ativo FROM tutores_alunos a
        JOIN tutores t ON t.id=a.tutor_id JOIN conta_tutora c ON c.id=1 AND c.cnpj=t.cnpj
        WHERE a.aluno_id=?""",(aluno_id,)).fetchone()


def redistribuir_pendentes(con,alunos):
    # Uma edição não sorteia novamente pedidos que já têm um destinatário válido.
    # Reavalia todos para incluir os que aguardavam um tutor e os sorteados para
    # um tutor que acabou de ser desativado. Os atendidos não são alterados.
    pedidos=con.execute("SELECT id,aluno_id FROM pedidos WHERE estado!='atendido'").fetchall()
    for pedido_id,aluno_id in pedidos:
        vinculo=tutor_vinculado(con,aluno_id)
        atual=con.execute("""SELECT p.tutor_id,p.origem,t.nome FROM pedidos_tutores p
            JOIN tutores t ON t.id=p.tutor_id AND t.ativo=1
            JOIN conta_tutora c ON c.id=1 AND c.cnpj=t.cnpj WHERE p.pedido_id=?""",(pedido_id,)).fetchone()
        manter = bool(atual and ((vinculo and vinculo[2] and atual[0]==vinculo[0] and atual[1]=='responsavel')
                                or (not vinculo and atual[1]=='aleatorio')))
        if manter:
            con.execute('UPDATE pedidos_tutores SET tutor_nome=? WHERE pedido_id=?',(atual[2],pedido_id))
            continue
        con.execute('DELETE FROM pedidos_tutores WHERE pedido_id=?',(pedido_id,))
        registrar_responsavel(con,pedido_id,aluno_id)


def salvar_tutor(db,dados,perfil,editar=False):
    exigir_administrador(perfil)
    nome,usuario,senha=dados.get('nome'),dados.get('usuario'),dados.get('senha','')
    if not isinstance(nome,str) or not 1<=len(nome.strip())<=120:
        raise ErroCadastro('Informe o nome do tutor com até 120 caracteres.')
    try:chave=normalizar_usuario(usuario)
    except ValueError as erro:raise ErroCadastro(str(erro)) from erro
    ativo=dados.get('ativo',True)
    if type(ativo) is not bool:raise ErroCadastro('Informe a situação do tutor.')
    alunos=dados.get('alunos',[])
    if not isinstance(alunos,list) or len(alunos)>1000 or any(not isinstance(a,str) or not 1<=len(a)<=80 for a in alunos):
        raise ErroCadastro('Selecione os alunos do tutor.')
    alunos=set(alunos)
    minimo=3 if perfil['cnpj']==CODIGO_DEMO else 10
    if not isinstance(senha,str) or (not editar or senha) and not minimo<=len(senha)<=128:
        raise ErroCadastro(f'A senha deve ter de {minimo} a 128 caracteres.')
    identificador=dados.get('id') if editar else uuid.uuid4().hex
    if not isinstance(identificador,str):raise ErroCadastro('Identificação de tutor inválida.')
    credencial=None
    if senha:
        sal=secrets.token_bytes(16)
        credencial=(sal.hex(),hashlib.pbkdf2_hmac('sha256',senha.encode('utf-8'),sal,ITERACOES).hex(),ITERACOES)
    with closing(sqlite3.connect(db,timeout=10)) as con, con:
        con.execute('BEGIN IMMEDIATE')
        conta=con.execute('SELECT cnpj,usuario FROM conta_tutora WHERE id=1').fetchone()
        if not conta or conta[0]!=perfil['cnpj']:raise ErroAcesso('A instituição foi alterada. Entre novamente.',401)
        if chave==normalizar_usuario(conta[1]):raise ErroCadastro('Este usuário pertence ao acesso administrativo.',409)
        duplicado=con.execute('SELECT id FROM tutores WHERE cnpj=? AND usuario_chave=? AND id!=?',(perfil['cnpj'],chave,identificador)).fetchone()
        if duplicado:raise ErroCadastro('Já existe um tutor com esse usuário nesta instituição.',409)
        antigos=set()
        if editar:
            atual=registro(con,identificador)
            instituicao=con.execute('SELECT cnpj FROM tutores WHERE id=?',(identificador,)).fetchone()[0]
            if instituicao!=perfil['cnpj']:raise ErroCadastro('Tutor não encontrado.',404)
            if type(dados.get('versao')) is not int or dados['versao']!=atual['versao']:
                raise ErroCadastro('Este tutor foi alterado. Atualize a lista e abra a edição novamente.',409)
            antigos=set(atual['alunos'])
        transferidos=set()
        for aluno in alunos:
            if not con.execute('SELECT 1 FROM alunos WHERE id=?',(aluno,)).fetchone():raise ErroCadastro('Um aluno não existe mais. Atualize a lista.',409)
            outro=con.execute('SELECT tutor_id FROM tutores_alunos WHERE aluno_id=? AND tutor_id!=?',(aluno,identificador)).fetchone()
            if outro:
                if dados.get('confirmar_transferencia') is not True:raise ErroCadastro('Confirme a transferência dos alunos que têm outro tutor responsável.',409)
                transferidos.add(outro[0])
        if editar:
            con.execute('UPDATE tutores SET nome=?,usuario=?,usuario_chave=?,ativo=?,versao=versao+1 WHERE id=?',(nome.strip(),usuario.strip(),chave,int(ativo),identificador))
            if credencial:con.execute('UPDATE tutores SET sal=?,senha_hash=?,iteracoes=? WHERE id=?',(*credencial,identificador))
            con.execute('DELETE FROM sessoes_tutores WHERE tutor_id=?',(identificador,))
        else:
            con.execute('INSERT INTO tutores (id,cnpj,nome,usuario,usuario_chave,sal,senha_hash,iteracoes,ativo) VALUES (?,?,?,?,?,?,?,?,?)',(identificador,perfil['cnpj'],nome.strip(),usuario.strip(),chave,*credencial,int(ativo)))
        con.execute('DELETE FROM tutores_alunos WHERE tutor_id=?',(identificador,))
        for aluno in alunos:
            con.execute('INSERT OR REPLACE INTO tutores_alunos VALUES (?,?)',(aluno,identificador))
        for outro in transferidos:con.execute('UPDATE tutores SET versao=versao+1 WHERE id=?',(outro,))
        redistribuir_pendentes(con,antigos|alunos)
        return registro(con,identificador)


def registrar_responsavel(con,pedido_id,aluno_id):
    # Chamado na mesma transação que registra o pedido. Reenvios e consultas
    # preservam o destinatário escolhido na primeira gravação.
    if con.execute('SELECT 1 FROM pedidos_tutores WHERE pedido_id=?',(pedido_id,)).fetchone():
        return
    vinculo=tutor_vinculado(con,aluno_id)
    if vinculo:
        if not vinculo[2]:
            return  # Responsável inativo: o administrador acompanha, sem desviar o vínculo.
        identificador,nome,_=vinculo
        origem='responsavel'
    else:
        candidatos=con.execute("""SELECT t.id,t.nome FROM tutores t
            JOIN conta_tutora c ON c.id=1 AND c.cnpj=t.cnpj
            WHERE t.ativo=1 ORDER BY t.id""").fetchall()
        if not candidatos:
            return
        identificador,nome=secrets.choice(candidatos)
        origem='aleatorio'
    con.execute('INSERT INTO pedidos_tutores (pedido_id,tutor_id,tutor_nome,origem) VALUES (?,?,?,?)',
                (pedido_id,identificador,nome,origem))


def pode_atender(con,pedido_id,perfil):
    if not perfil or not perfil.get('tutor_id'):return bool(perfil)
    return bool(con.execute('SELECT 1 FROM pedidos_tutores WHERE pedido_id=? AND tutor_id=?',(pedido_id,perfil['tutor_id'])).fetchone())
