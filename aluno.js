"use strict";
const $ = id => document.getElementById(id);
let ocupado = false, geracao = 0, assinatura = '', configurado = false;
let catalogo = null, alunoAtualId = null, categoriaAtual = null, mensagemSelecionada = null;
let naEntrada = true, assinaturaEntrada = '';

async function api(rota, dados) {
  const controle = new AbortController();
  const tempo = setTimeout(() => controle.abort(), 8000);
  try {
    const resposta = await fetch(rota, {method:dados ? 'POST' : 'GET',credentials:'same-origin',cache:'no-store',signal:controle.signal,
      headers:{'X-Portal':'aluno',...(dados ? {'Content-Type':'application/json'} : {})},...(dados ? {body:JSON.stringify(dados)} : {})});
    const valor = await resposta.json();
    if (!resposta.ok) { const erro = new Error(valor.erro || 'Não foi possível continuar.'); erro.status = resposta.status; throw erro; }
    return valor;
  } catch (erro) {
    if (erro.status) throw erro;
    throw new Error('Não foi possível conectar ao servidor. Confira a rede e tente atualizar.');
  } finally { clearTimeout(tempo); }
}

function desenho(icone) {
  const bloco = document.createElement('span'); bloco.className = 'desenho-comunicacao'; bloco.setAttribute('aria-hidden','true');
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 64 64'); svg.setAttribute('focusable','false');
  const use = document.createElementNS('http://www.w3.org/2000/svg','use');
  use.setAttribute('href','/pictogramas.svg#' + (/^[a-z_]+$/.test(icone) ? icone : 'mensagem'));
  svg.append(use); bloco.append(svg); return bloco;
}

function selecionarMensagem(mensagem) {
  mensagemSelecionada = mensagem.id;
  for (const botao of $('opcoes-comunicacao').querySelectorAll('[data-mensagem]')) {
    botao.setAttribute('aria-pressed',String(botao.dataset.mensagem === mensagem.id));
  }
  $('texto-mensagem').textContent = mensagem.frase;
  $('selecao-mensagem').hidden = false;
}

function renderizarComunicacao(focar=false) {
  if (!catalogo) return;
  const categoria = catalogo.categorias.find(c => c.id === categoriaAtual);
  $('titulo-comunicacao').textContent = categoria ? categoria.rotulo : 'O que você quer comunicar?';
  $('descricao-comunicacao').textContent = categoria ? 'Toque na mensagem que você quer escolher.' : 'Escolha uma categoria ou peça ajuda.';
  $('inicio-comunicacao').hidden = !categoria;
  $('opcoes-comunicacao').classList.toggle('em-categoria',Boolean(categoria));
  $('selecao-mensagem').hidden = true; $('texto-mensagem').textContent = ''; mensagemSelecionada = null;
  const fragmento = document.createDocumentFragment();
  const opcoes = categoria ? categoria.mensagens : [...catalogo.categorias,catalogo.ajuda];
  for (const opcao of opcoes) {
    const mensagem = Boolean(categoria) || opcao.id === 'ajuda';
    const botao = document.createElement('button'); botao.type = 'button';
    botao.className = 'opcao-comunicacao' + (opcao.id === 'ajuda' ? ' ajuda' : '');
    const texto = document.createElement('span'); texto.className = 'texto-opcao';
    const titulo = document.createElement('strong'); titulo.textContent = opcao.rotulo;
    const descricao = document.createElement('small'); descricao.textContent = mensagem ? opcao.frase : opcao.descricao;
    texto.append(titulo,descricao); botao.append(desenho(opcao.icone),texto);
    if (mensagem) {
      botao.dataset.mensagem = opcao.id; botao.setAttribute('aria-pressed','false'); botao.setAttribute('aria-label',opcao.rotulo + ': ' + opcao.frase);
      botao.addEventListener('click',() => selecionarMensagem(opcao));
    } else {
      botao.dataset.categoria = opcao.id;
      botao.addEventListener('click',() => { categoriaAtual = opcao.id; renderizarComunicacao(true); });
    }
    fragmento.append(botao);
  }
  $('opcoes-comunicacao').replaceChildren(fragmento);
  if (focar) $('titulo-comunicacao').focus({preventScroll:true});
}

$('inicio-comunicacao').addEventListener('click',() => { categoriaAtual = null; renderizarComunicacao(true); });

function limparIdentidade() {
  alunoAtualId = null; categoriaAtual = null; mensagemSelecionada = null;
  $('opcoes-comunicacao').replaceChildren(); $('selecao-mensagem').hidden = true; $('texto-mensagem').textContent = '';
  $('nome-aluno').textContent = ''; $('nome-comunicador').textContent = '';
  $('foto').hidden = true; $('foto').removeAttribute('src'); $('iniciais').textContent = '';
  $('identidade').hidden = true; $('vinculo-pendente').hidden = true;
  $('comunicador-pendente').textContent = ''; $('titulo-pendente').textContent = ''; $('descricao-pendente').textContent = '';
}

function exibirEntrada() {
  limparIdentidade(); configurado = false; assinatura = ''; naEntrada = true;
  document.body.classList.add('escolhendo-aluno');
  $('carregando').hidden = true; $('escolha-aluno').hidden = false;
  $('acoes').hidden = true; $('acesso-entrada').hidden = true;
}

function exibirBlocos(lista) {
  const nova = JSON.stringify(lista);
  if (nova === assinaturaEntrada) return;
  assinaturaEntrada = nova;
  const foco = document.activeElement.closest('[data-aluno]')?.dataset.aluno;
  const fragmento = document.createDocumentFragment();
  for (const aluno of lista) {
    const botao = document.createElement('button'); botao.type = 'button'; botao.className = 'bloco-aluno'; botao.dataset.aluno = aluno.id;
    botao.setAttribute('aria-label','Entrar como ' + aluno.nome + ', ' + aluno.tag.rotulo);
    const retrato = document.createElement('span'); retrato.className = 'retrato-bloco';
    const iniciais = document.createElement('span'); iniciais.className = 'iniciais-bloco'; iniciais.setAttribute('aria-hidden','true');
    iniciais.textContent = aluno.nome.trim().split(/\s+/u).slice(0,2).map(p => Array.from(p)[0]).join('').toLocaleUpperCase('pt-BR');
    retrato.append(iniciais);
    if (aluno.foto_url) {
      const foto = document.createElement('img'); foto.alt = ''; foto.src = aluno.foto_url;
      foto.addEventListener('error',() => foto.remove()); retrato.append(foto);
    }
    const nome = document.createElement('strong'); nome.className = 'nome-bloco'; nome.textContent = aluno.nome;
    const tag = document.createElement('span'); tag.className = 'tag-aluno cor-' + aluno.tag.cor; tag.textContent = aluno.tag.rotulo;
    botao.append(retrato,nome,tag); botao.addEventListener('click',() => entrarAluno(aluno.id)); fragmento.append(botao);
  }
  $('blocos-alunos').replaceChildren(fragmento); $('sem-alunos').hidden = lista.length !== 0;
  if (foco) {
    const anterior = [...$('blocos-alunos').children].find(b => b.dataset.aluno === foco);
    (anterior || $('titulo-escolha')).focus({preventScroll:true});
  }
}

async function carregarEntrada() {
  let lista;
  try { lista = await api('/api/aluno/entrada'); }
  catch (erro) {
    if (erro.status !== 401) throw erro;
    // A liberação exige a sessão administrativa; depois só permanece o acesso à grade.
    try { await api('/api/aluno/liberar',{}); lista = await api('/api/aluno/entrada'); }
    catch (falha) {
      if (falha.status !== 401) throw falha;
      limparIdentidade(); assinaturaEntrada = ''; $('blocos-alunos').replaceChildren();
      $('carregando').hidden = true; $('escolha-aluno').hidden = true;
      $('acesso-entrada').hidden = false; $('acoes').hidden = true; $('falha-conexao').hidden = true;
      return;
    }
  }
  exibirEntrada(); exibirBlocos(lista); $('falha-conexao').hidden = true;
}

async function entrarAluno(identificador) {
  if (ocupado) return;
  ocupado = true; geracao++;
  $('blocos-alunos').setAttribute('aria-busy','true');
  for (const botao of $('blocos-alunos').children) botao.disabled = true;
  try {
    await api('/api/aluno/selecionar',{aluno_id:identificador});
    naEntrada = false; assinatura = ''; configurado = true;
  } catch (erro) {
    $('falha-conexao').textContent = erro.message; $('falha-conexao').hidden = false;
    if (erro.status === 409 || erro.status === 401) {
      assinaturaEntrada = ''; await carregarEntrada();
      $('falha-conexao').textContent = erro.message; $('falha-conexao').hidden = false;
    }
  } finally {
    ocupado = false; $('blocos-alunos').setAttribute('aria-busy','false');
    for (const botao of $('blocos-alunos').children) botao.disabled = false;
  }
  if (!naEntrada) {
    await atualizar();
    if (!naEntrada) $('titulo-comunicacao').focus({preventScroll:true});
  }
}

function exibirContexto(contexto) {
  const nova = JSON.stringify(contexto);
  configurado = true;
  $('carregando').hidden = true; $('escolha-aluno').hidden = true; $('acoes').hidden = false;
  $('acesso-entrada').hidden = true; document.body.classList.remove('escolhendo-aluno');
  $('falha-conexao').hidden = true;
  if (nova === assinatura) return;
  assinatura = nova;
  if (contexto.situacao === 'vinculado') {
    const aluno = contexto.aluno;
    $('vinculo-pendente').hidden = true;
    $('foto').hidden = true; $('foto').removeAttribute('src');
    if (alunoAtualId !== aluno.id) {
      alunoAtualId = aluno.id; categoriaAtual = null; renderizarComunicacao();
    }
    $('nome-comunicador').textContent = contexto.dispositivo;
    $('nome-aluno').textContent = aluno.nome;
    $('iniciais').textContent = aluno.nome.trim().split(/\s+/u).slice(0,2).map(parte => Array.from(parte)[0]).join('').toLocaleUpperCase('pt-BR');
    if (aluno.foto_url) { $('foto').src = aluno.foto_url; $('foto').hidden = false; }
    $('identidade').hidden = false;
    $('aviso').textContent = 'Aluno vinculado carregado: ' + aluno.nome + '.';
  } else {
    limparIdentidade();
    const mensagens = {
      sem_aluno:['Aguardando vínculo','Peça à tutora para vincular um aluno a este comunicador.'],
      aluno_inativo:['Cadastro inativo','Peça à tutora para revisar o cadastro ou o vínculo deste comunicador.'],
      indisponivel:['Comunicador indisponível','Peça à tutora para revisar a configuração deste aparelho.'],
    };
    const [titulo,descricao] = mensagens[contexto.situacao] || mensagens.indisponivel;
    $('comunicador-pendente').textContent = contexto.dispositivo;
    $('titulo-pendente').textContent = titulo; $('descricao-pendente').textContent = descricao;
    $('vinculo-pendente').hidden = false; $('aviso').textContent = titulo + '. ' + descricao;
  }
}

async function atualizar() {
  if (ocupado) return;
  ocupado = true;
  const atual = geracao;
  $('atualizar').disabled = true;
  try {
    if (naEntrada) { await carregarEntrada(); return; }
    const contexto = await api('/api/aluno/perfil');
    const opcoes = contexto.situacao === 'vinculado' && !catalogo ? await api('/api/aluno/catalogo') : catalogo;
    if (atual === geracao) { catalogo = opcoes; exibirContexto(contexto); }
  } catch (erro) {
    if (atual !== geracao) return;
    if (erro.status === 401) { exibirEntrada(); await carregarEntrada(); }
    else {
      // Não apresentar um aluno antigo como se o vínculo ainda estivesse confirmado.
      limparIdentidade(); assinatura = ''; $('carregando').hidden = true;
      $('falha-conexao').textContent = erro.message; $('falha-conexao').hidden = false;
      $('acoes').hidden = false;
    }
  } finally { if (atual === geracao) { ocupado = false; $('atualizar').disabled = false; } }
}

$('atualizar').addEventListener('click',atualizar);
$('foto').addEventListener('error', () => { $('foto').hidden = true; $('foto').removeAttribute('src'); });
$('trocar-aluno').addEventListener('click',async () => {
  if (ocupado) return;
  ocupado = true; geracao++;
  try {
    await api('/api/aluno/desconectar',{});
    exibirEntrada(); assinaturaEntrada = ''; await carregarEntrada();
    $('blocos-alunos').querySelector('button')?.focus({preventScroll:true});
  } catch (erro) { $('falha-conexao').textContent = erro.message; $('falha-conexao').hidden = false; }
  finally { ocupado = false; }
});
atualizar();
setInterval(() => { if (!document.hidden) atualizar(); },15000);
window.addEventListener('online',atualizar);
document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });
