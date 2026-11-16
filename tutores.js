"use strict";
let tutores = [], tutorEdicao = null, salvandoTutor = false, geracaoTutor = 0, consultaTutores = null;

function limparTutores() {
  geracaoTutor++; tutores = []; tutorEdicao = null; salvandoTutor = false; consultaTutores = null;
  $('formulario-tutor').reset(); $('formulario-tutor').hidden = true; $('campos-tutor').disabled = false;
  $('lista-tutores').replaceChildren(); $('alunos-tutor').replaceChildren();
  $('atualizar-tutores').disabled = false;
  $('quantidade-tutores').textContent = ''; $('erro-tutores').hidden = true; $('erro-tutor').hidden = true;
  $('novo-tutor').disabled = false; $('novo-tutor').setAttribute('aria-expanded','false'); $('salvar-tutor').textContent = 'Salvar tutor';
}

function renderizarTutores() {
  const fragmento = document.createDocumentFragment();
  for (const tutor of tutores) {
    const linha = elemento('li','registro-comunicador-vinculo');
    const dados = elemento('div','aluno-dados');
    dados.append(elemento('h2','',tutor.nome),elemento('p','','Usuário: ' + tutor.usuario + ' · ' + (tutor.ativo ? 'Ativo' : 'Inativo')));
    const nomesAlunos = tutor.alunos.map(id => alunos.find(a => a.id === id)?.nome || 'Aluno indisponível');
    dados.append(elemento('p','',nomesAlunos.length ? 'Alunos: ' + nomesAlunos.join(', ') : 'Nenhum aluno atribuído'));
    const editar = elemento('button','botao-texto','Editar tutor'); editar.type = 'button';
    editar.setAttribute('aria-label','Editar tutor: ' + tutor.nome);
    editar.addEventListener('click',() => abrirTutor(tutor));
    linha.append(dados,editar); fragmento.append(linha);
  }
  $('lista-tutores').replaceChildren(fragmento);
  $('quantidade-tutores').textContent = tutores.length ? tutores.length + ' tutor(es) cadastrado(s)' : 'Nenhum tutor cadastrado.';
}

async function atualizarTutores() {
  if (!conectado || perfilLogado?.tutor_id) return;
  if (consultaTutores) return consultaTutores;
  const atual = sessao;
  $('atualizar-tutores').disabled = true;
  $('erro-tutores').hidden = true;
  consultaTutores = (async () => {
    try {
      await atualizarAlunos();
      if (atual !== sessao || !conectado) return;
      const lista = await api('/api/tutores');
      if (atual !== sessao || !conectado) return;
      tutores = lista; renderizarTutores();
    } catch (erro) {
      if (atual !== sessao || !conectado) return;
      if (erro.status === 401) tratarErroCadastro(erro);
      else { $('erro-tutores').textContent = erro.message; $('erro-tutores').hidden = false; }
    } finally { if (atual === sessao) $('atualizar-tutores').disabled = false; }
  })();
  const operacao = consultaTutores; await operacao;
  if (consultaTutores === operacao) consultaTutores = null;
}

function fecharTutor(focar=true) {
  geracaoTutor++; tutorEdicao = null;
  $('formulario-tutor').reset(); $('tutor-senha').value = ''; $('formulario-tutor').hidden = true;
  $('erro-tutor').hidden = true; $('novo-tutor').disabled = false; $('novo-tutor').setAttribute('aria-expanded','false');
  if (focar) $('novo-tutor').focus();
}

function abrirTutor(tutor=null) {
  if (salvandoTutor || !alunosCarregados || !conectado || perfilLogado?.tutor_id) return;
  fecharTutor(false); tutorEdicao = tutor;
  $('titulo-formulario-tutor').textContent = tutor ? 'Editar tutor' : 'Novo tutor';
  $('tutor-instituicao').textContent = 'CNPJ / código da instituição: ' + perfilLogado.cnpj;
  $('tutor-nome').value = tutor?.nome || ''; $('tutor-usuario').value = tutor?.usuario || '';
  $('tutor-ativo').checked = tutor ? Boolean(tutor.ativo) : true;
  $('tutor-senha').required = !tutor;
  $('tutor-senha').minLength = perfilLogado.cnpj === '164275' ? 3 : 10;
  $('dica-tutor-senha').textContent = (tutor ? 'Deixe em branco para manter a senha. ' : '') + 'Mínimo de ' + $('tutor-senha').minLength + ' caracteres.';
  const fragmento = document.createDocumentFragment();
  for (const aluno of alunos) {
    const label = elemento('label','opcao-aluno-tutor');
    const campo = document.createElement('input'); campo.type = 'checkbox'; campo.value = aluno.id; campo.checked = Boolean(tutor?.alunos.includes(aluno.id));
    const responsavel = tutores.find(t => t.id !== tutor?.id && t.alunos.includes(aluno.id));
    label.append(campo,elemento('span','',aluno.nome + (aluno.ativo ? '' : ' (inativo)') + (responsavel ? ' — tutor atual: ' + responsavel.nome : '')));
    fragmento.append(label);
  }
  if (!alunos.length) fragmento.append(elemento('p','dica-aluno','Cadastre os alunos na aba Alunos para atribuí-los ao tutor.'));
  $('alunos-tutor').replaceChildren(fragmento);
  $('formulario-tutor').hidden = false; $('novo-tutor').disabled = true; $('novo-tutor').setAttribute('aria-expanded','true');
  $('tutor-nome').focus();
}

$('formulario-tutor').addEventListener('submit',async evento => {
  evento.preventDefault();
  if (salvandoTutor || !conectado) return;
  if (!$('formulario-tutor').reportValidity()) return;
  const ids = [...$('alunos-tutor').querySelectorAll('input:checked')].map(c => c.value);
  const transferidos = tutores.filter(t => t.id !== tutorEdicao?.id && t.alunos.some(id => ids.includes(id)));
  if (transferidos.length && !window.confirm('Transferir para este tutor os alunos que hoje pertencem a ' + transferidos.map(t => t.nome).join(', ') + '? Os chamados pendentes também serão transferidos.')) return;
  const dados = {nome:$('tutor-nome').value.trim(),usuario:$('tutor-usuario').value.trim(),senha:$('tutor-senha').value,ativo:$('tutor-ativo').checked,alunos:ids,confirmar_transferencia:Boolean(transferidos.length)};
  if (tutorEdicao) Object.assign(dados,{id:tutorEdicao.id,versao:tutorEdicao.versao});
  const atual = sessao, geracao = geracaoTutor;
  salvandoTutor = true; $('campos-tutor').disabled = true; $('salvar-tutor').textContent = 'Salvando…'; $('erro-tutor').hidden = true;
  try {
    await api(tutorEdicao ? '/api/tutores/editar' : '/api/tutores',dados);
    if (atual !== sessao || geracao !== geracaoTutor || !conectado) return;
    fecharTutor(); if (consultaTutores) await consultaTutores;
    if (atual !== sessao || !conectado) return;
    await atualizarTutores(); assinatura = ''; await atualizar(); renderizar(true);
    if (atual === sessao && conectado) avisar('Tutor salvo. O acesso usa o código da instituição, usuário e senha cadastrados.');
  } catch (erro) {
    if (atual !== sessao || geracao !== geracaoTutor || !conectado) return;
    if (erro.status === 401) tratarErroCadastro(erro);
    else { $('erro-tutor').textContent = erro.message; $('erro-tutor').hidden = false; }
  } finally {
    dados.senha = ''; if (atual === sessao) { salvandoTutor = false; $('campos-tutor').disabled = false; $('salvar-tutor').textContent = 'Salvar tutor'; }
  }
});
$('nav-tutores').addEventListener('click',() => mudarVisao('tutores'));
$('novo-tutor').addEventListener('click',() => abrirTutor());
$('cancelar-tutor').addEventListener('click',() => fecharTutor());
$('atualizar-tutores').addEventListener('click',atualizarTutores);
