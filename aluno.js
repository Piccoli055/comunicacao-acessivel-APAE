"use strict";
const $ = id => document.getElementById(id);
let ocupado = false, geracao = 0, assinatura = '', configurado = false;
let catalogo = null, alunoAtualId = null, categoriaAtual = null, mensagemSelecionada = null;
let naEntrada = true, assinaturaEntrada = '';
let enviando = false, confirmacaoId = null;
let proximaTentativa = 0, intervaloFila = 5000;
let perfilAtual = 'padrao', indiceOpcao = 0, falaAtual = null;
const baixaVisao = () => perfilAtual === 'baixa_visao';
const perfilMotor = () => perfilAtual === 'motora';
const perfilCognitivo = () => perfilAtual === 'intelectual';
const perfilTea = () => perfilAtual === 'tea';
const ESSENCIAIS_COGNITIVOS = ['agua','banheiro','comida','descanso','mal_estar','ajuda'];
const INTERVALO_MOTOR = 600;
let toqueMotor = null, ultimoAcionamentoMotor = -Infinity;

function atualizarEtapaTea(etapa='escolher') {
  for (const id of ['etapas-tea','etapas-tea-confirmacao']) {
    $(id).hidden = !perfilTea();
    for (const item of $(id).children) {
      if (item.dataset.etapa === etapa) item.setAttribute('aria-current','step');
      else item.removeAttribute('aria-current');
    }
  }
}
function renderizarCategoriasTea() {
  const nav = $('categorias-tea');
  nav.hidden = !perfilTea();
  if (!perfilTea() || !catalogo) return;
  const assinaturaCategorias = JSON.stringify(catalogo.categorias.map(c => [c.id,c.rotulo,c.icone]));
  if (nav.dataset.assinatura !== assinaturaCategorias) {
    nav.replaceChildren();
    for (const categoria of catalogo.categorias) {
      const botao = document.createElement('button'); botao.type = 'button';
      botao.dataset.categoriaTea = categoria.id;
      botao.setAttribute('aria-controls','opcoes-comunicacao');
      const rotulo = document.createElement('span'); rotulo.textContent = categoria.rotulo;
      botao.append(desenho(categoria.icone),rotulo);
      botao.addEventListener('click',() => {
        if (enviando || !perfilTea() || categoriaAtual === categoria.id) return;
        categoriaAtual = categoria.id; renderizarComunicacao();
      });
      nav.append(botao);
    }
    nav.dataset.assinatura = assinaturaCategorias;
  }
  for (const botao of nav.children) botao.setAttribute('aria-pressed',String(botao.dataset.categoriaTea === categoriaAtual));
}

function limparToqueMotor() {
  toqueMotor?.alvo.classList.remove('toque-motor','toque-cancelado');
  toqueMotor = null;
}
function controleMotor(evento) {
  return evento.target instanceof Element ? evento.target.closest('button,a') : null;
}
function dentroControle(alvo,evento) {
  const r = alvo.getBoundingClientRect();
  return evento.clientX >= r.left && evento.clientX <= r.right && evento.clientY >= r.top && evento.clientY <= r.bottom;
}
document.addEventListener('pointerdown',evento => {
  if (!perfilMotor()) return;
  if (!evento.isPrimary) { if (toqueMotor) toqueMotor.cancelado = true; return; }
  limparToqueMotor();
  const alvo = controleMotor(evento);
  if (!alvo || alvo.disabled || evento.button !== 0) return;
  toqueMotor = {alvo,id:evento.pointerId,cancelado:false,terminou:false};
  alvo.classList.add('toque-motor');
},true);
document.addEventListener('pointermove',evento => {
  if (!toqueMotor || evento.pointerId !== toqueMotor.id) return;
  if (!dentroControle(toqueMotor.alvo,evento)) {
    toqueMotor.cancelado = true;
    toqueMotor.alvo.classList.add('toque-cancelado');
  }
},true);
document.addEventListener('pointerup',evento => {
  if (!toqueMotor || evento.pointerId !== toqueMotor.id) return;
  toqueMotor.terminou = true;
  toqueMotor.cancelado ||= !dentroControle(toqueMotor.alvo,evento);
  toqueMotor.alvo.classList.remove('toque-motor','toque-cancelado');
},true);
document.addEventListener('pointercancel',evento => {
  if (toqueMotor && evento.pointerId === toqueMotor.id) {
    toqueMotor.cancelado = true; toqueMotor.terminou = true;
    toqueMotor.alvo.classList.remove('toque-motor','toque-cancelado');
  }
},true);
document.addEventListener('click',evento => {
  if (!perfilMotor()) return;
  const alvo = controleMotor(evento);
  if (!alvo) return;
  // Preserva clicks de teclado/apoio que não tenham uma sequência de ponteiro associada.
  const cancelado = evento.detail > 0 && toqueMotor && (toqueMotor.alvo !== alvo || !toqueMotor.terminou || toqueMotor.cancelado);
  limparToqueMotor();
  if (cancelado || performance.now()-ultimoAcionamentoMotor < INTERVALO_MOTOR) {
    evento.preventDefault(); evento.stopImmediatePropagation();
    $('aviso-motor').textContent = cancelado ? 'Toque cancelado. Nada foi selecionado.' : 'Toque repetido ignorado. Você pode tentar novamente.';
    return;
  }
  ultimoAcionamentoMotor = performance.now();
  $('aviso-motor').textContent = '';
},true);
window.addEventListener('blur',limparToqueMotor);

function pararVoz() {
  falaAtual = null;
  try { window.speechSynthesis?.cancel(); } catch (_) { /* Não impede a comunicação visual. */ }
}
function avisoVoz(texto='') {
  for (const id of ['aviso-voz','aviso-voz-confirmacao']) {
    $(id).textContent = texto; $(id).hidden = !texto;
  }
}
function falarOpcao(texto) {
  if (!baixaVisao()) return;
  pararVoz(); avisoVoz();
  try {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) throw new Error();
    const fala = new SpeechSynthesisUtterance(texto);
    fala.lang = 'pt-BR'; fala.rate = 0.9;
    const vozes = window.speechSynthesis.getVoices();
    fala.voice = vozes.find(v => /^pt[-_]BR$/i.test(v.lang) && v.localService) || vozes.find(v => /^pt[-_]BR$/i.test(v.lang)) || vozes.find(v => /^pt(?:[-_]|$)/i.test(v.lang)) || null;
    falaAtual = fala;
    fala.onerror = () => { if (falaAtual === fala) avisoVoz('A voz não está disponível. A mensagem continua na tela e pode ser enviada.'); };
    window.speechSynthesis.speak(fala);
  } catch (_) { avisoVoz('A voz não está disponível. A mensagem continua na tela e pode ser enviada.'); }
}
function aplicarPerfil(perfil) {
  pararVoz(); avisoVoz(); perfilAtual = perfil; indiceOpcao = 0;
  limparToqueMotor(); ultimoAcionamentoMotor = -Infinity;
  document.body.classList.toggle('baixa-visao',baixaVisao());
  document.body.classList.toggle('perfil-motor',perfilMotor());
  document.body.classList.toggle('perfil-cognitivo',perfilCognitivo());
  document.body.classList.toggle('perfil-tea',perfilTea());
  $('categorias-tea').hidden = !perfilTea();
  $('categorias-tea').replaceChildren(); delete $('categorias-tea').dataset.assinatura;
  atualizarEtapaTea();
  $('mais-mensagens').hidden = true;
  $('titulo-confirmacao').textContent = perfilCognitivo() ? 'Você escolheu:' : 'É isso que você quer dizer?';
  $('confirmar-mensagem').textContent = perfilCognitivo() ? 'Enviar' : 'Enviar mensagem';
  $('inicio-comunicacao').textContent = perfilCognitivo() ? '‹ Voltar' : '‹ Início';
  if (!$('resultado-envio').hidden && $('resultado-envio').dataset.situacao) exibirResultadoEnvio($('resultado-envio').dataset.situacao);
  $('orientacao-motora').hidden = !perfilMotor();
  $('aviso-motor').textContent = '';
  if (perfilMotor()) $('opcoes-comunicacao').setAttribute('aria-describedby','orientacao-motora');
  else $('opcoes-comunicacao').removeAttribute('aria-describedby');
  for (const id of ['apoio-baixa-visao','apoio-confirmacao','paginacao-baixa-visao']) $(id).hidden = !baixaVisao();
}
function opcoesAtuais() {
  if (perfilTea() && catalogo) {
    const categoria = catalogo.categorias.find(c => c.id === categoriaAtual) || catalogo.categorias[0];
    return [...(categoria?.mensagens || []),catalogo.ajuda];
  }
  if (perfilCognitivo() && catalogo) {
    const todas = [...catalogo.categorias.flatMap(c => c.mensagens),catalogo.ajuda];
    return categoriaAtual === 'mais_mensagens' ? todas.filter(m => !ESSENCIAIS_COGNITIVOS.includes(m.id)) : ESSENCIAIS_COGNITIVOS.map(id => todas.find(m => m.id === id)).filter(Boolean);
  }
  const categoria = catalogo?.categorias.find(c => c.id === categoriaAtual);
  return categoria ? categoria.mensagens : (baixaVisao() ? catalogo?.categorias || [] : [...(catalogo?.categorias || []),catalogo?.ajuda]);
}
function exibirResultadoEnvio(situacao) {
  $('resultado-envio').dataset.situacao = situacao;
  $('resultado-envio').textContent = situacao === 'enviado'
    ? (perfilCognitivo() ? 'Mensagem enviada' : 'Mensagem enviada à tutora.')
    : (perfilCognitivo() ? 'Aguardando envio' : 'Mensagem guardada. Aguardando envio à tutora.');
  $('resultado-envio').hidden = false;
  if (perfilTea()) atualizarEtapaTea('resultado');
}
$('mais-mensagens').addEventListener('click',() => {
  if (enviando || !perfilCognitivo()) return;
  categoriaAtual = 'mais_mensagens'; renderizarComunicacao(true);
});

function moverOpcao(delta) {
  if (enviando || !baixaVisao()) return;
  indiceOpcao = Math.max(0,Math.min(opcoesAtuais().length-1,indiceOpcao+delta));
  renderizarComunicacao();
  const opcao = opcoesAtuais()[indiceOpcao];
  if (opcao) falarOpcao(opcao.frase || opcao.rotulo);
}
$('opcao-anterior').addEventListener('click',() => moverOpcao(-1));
$('opcao-proxima').addEventListener('click',() => moverOpcao(1));
$('ajuda-baixa-visao').addEventListener('click',() => { if (catalogo) selecionarMensagem(catalogo.ajuda); });
$('ajuda-confirmacao').addEventListener('click',() => { if (catalogo) selecionarMensagem(catalogo.ajuda); });
$('voltar-confirmacao-baixa-visao').addEventListener('click',() => { if (!enviando) fecharConfirmacao(true); });
$('voltar-baixa-visao').addEventListener('click',() => {
  if (enviando) return;
  if (categoriaAtual) { categoriaAtual = null; indiceOpcao = 0; renderizarComunicacao(true); }
  else $('trocar-aluno').click();
});
window.addEventListener('pagehide',pararVoz);

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
  if (enviando) return;
  confirmacaoId = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2,'0')).join('');
  $('resultado-envio').hidden = true;
  $('aviso-confirmacao').textContent = 'A mensagem será enviada à tutora.';
  mensagemSelecionada = mensagem.id;
  for (const botao of $('opcoes-comunicacao').querySelectorAll('[data-mensagem]')) {
    botao.setAttribute('aria-pressed',String(botao.dataset.mensagem === mensagem.id));
  }
  $('texto-mensagem').textContent = mensagem.frase;
  if (!$('selecao-mensagem').open) $('selecao-mensagem').showModal();
  $('desenho-confirmacao').replaceChildren(desenho(mensagem.icone));
  $('titulo-confirmacao').focus({preventScroll:true});
  falarOpcao(mensagem.frase);
  if (perfilTea()) atualizarEtapaTea('confirmar');
}

function fecharConfirmacao(restaurarFoco=false) {
  atualizarEtapaTea();
  pararVoz(); avisoVoz();
  const anterior = mensagemSelecionada;
  if ($('selecao-mensagem').open) $('selecao-mensagem').close();
  if (restaurarFoco && baixaVisao() && anterior === 'ajuda') $('ajuda-baixa-visao').focus({preventScroll:true});
  mensagemSelecionada = null; confirmacaoId = null;
  $('texto-mensagem').textContent = '';
  $('desenho-confirmacao').replaceChildren();
  for (const botao of $('opcoes-comunicacao').querySelectorAll('[data-mensagem]')) {
    botao.setAttribute('aria-pressed','false');
    if (restaurarFoco && botao.dataset.mensagem === anterior) botao.focus({preventScroll:true});
  }
}
$('voltar-mensagem').addEventListener('click',() => { if (!enviando) fecharConfirmacao(true); });
$('selecao-mensagem').addEventListener('cancel',evento => {
  evento.preventDefault(); if (!enviando) fecharConfirmacao(true);
});

async function mostrarFila() {
  try {
    const lista = await FilaAluno.listar();
    const desteAluno = lista.filter(p => p.aluno_id === alunoAtualId);
    $('painel-fila').hidden = lista.length === 0;
    $('resumo-fila').textContent = 'Pedidos aguardando envio: ' + lista.length + '. ' +
      (alunoAtualId ? desteAluno.length + ' deste aluno. ' : 'Escolha o aluno que fez o pedido para retomar o envio. ') +
      (lista.some(p => p.bloqueado) ? 'Há pedidos bloqueados. Peça à tutora para revisar o cadastro ou limpar a fila.' : 'O envio será retomado quando houver conexão e o mesmo aluno estiver selecionado.');
    $('reenviar-fila').disabled = enviando || !desteAluno.some(p => !p.bloqueado);
    $('limpar-fila').disabled = enviando;
  } catch (_) {
    $('painel-fila').hidden = false;
    $('resumo-fila').textContent = 'Armazenamento indisponível. Não é possível guardar novos pedidos neste navegador.';
    $('reenviar-fila').disabled = true; $('limpar-fila').disabled = true;
  }
}

async function sincronizarFila(forcar=false) {
  if (enviando || ocupado || naEntrada || !alunoAtualId || $('selecao-mensagem').open || !navigator.onLine || (!forcar && Date.now()<proximaTentativa)) return;
  enviando = true;
  const aluno = alunoAtualId, atual = geracao;
  try {
    const lista = (await FilaAluno.listar()).filter(p => p.aluno_id === aluno && !p.bloqueado).sort((a,b) => a.criado-b.criado || a.id.localeCompare(b.id));
    for (const pedido of lista) {
      if (atual !== geracao || aluno !== alunoAtualId) break;
      try {
        await api('/api/aluno/enviar',{id:pedido.id,mensagem:pedido.mensagem,aluno_id:pedido.aluno_id});
        await FilaAluno.remover(pedido.id);
        intervaloFila = 5000; proximaTentativa = 0;
        if (atual === geracao) {
          exibirResultadoEnvio('enviado');
        }
      } catch (erro) {
        proximaTentativa = Date.now()+intervaloFila;
        intervaloFila = Math.min(intervaloFila*2,30000);
        if ([400,403,409].includes(erro.status)) await FilaAluno.salvar({...pedido,bloqueado:true});
        if (erro.status === 401 || erro.status === 409) {
          limparIdentidade(); assinatura = '';
          $('falha-conexao').textContent = erro.message + ' Os pedidos continuam guardados na fila.';
          $('falha-conexao').hidden = false;
        }
        break; // Não remove nada sem a confirmação do servidor.
      }
    }
  } catch (_) {
    $('falha-conexao').textContent = 'Não foi possível acessar a fila. Os pedidos não foram confirmados como enviados.';
    $('falha-conexao').hidden = false;
  } finally { enviando = false; await mostrarFila(); }
}

$('confirmar-mensagem').addEventListener('click',async () => {
  if (enviando || !mensagemSelecionada || !confirmacaoId || !alunoAtualId) return;
  enviando = true;
  $('confirmar-mensagem').disabled = true; $('voltar-mensagem').disabled = true;
  $('selecao-mensagem').setAttribute('aria-busy','true');
  $('aviso-confirmacao').textContent = 'Guardando mensagem…';
  try {
    await FilaAluno.salvar({id:confirmacaoId,mensagem:mensagemSelecionada,aluno_id:alunoAtualId,criado:Date.now()});
    fecharConfirmacao(true);
    exibirResultadoEnvio('aguardando');
  } catch (_) {
    $('aviso-confirmacao').textContent = 'Não foi possível guardar a mensagem neste navegador. Nada foi enviado. Tente novamente ou peça ajuda à tutora.';
  } finally {
    enviando = false;
    $('confirmar-mensagem').disabled = false; $('voltar-mensagem').disabled = false;
    $('selecao-mensagem').setAttribute('aria-busy','false');
  }
  await mostrarFila(); await sincronizarFila(true);
});
$('reenviar-fila').addEventListener('click',() => sincronizarFila(true));
$('limpar-fila').addEventListener('click',async () => {
  if (enviando || !window.confirm('Descartar todos os pedidos que aguardam envio neste navegador, de todos os alunos? Pedidos já recebidos pelo servidor não serão apagados.')) return;
  enviando = true;
  try {
    await FilaAluno.limpar();
    $('resultado-envio').hidden = true;
  } catch (_) {
    $('falha-conexao').textContent = 'Não foi possível limpar a fila. Tente novamente.';
    $('falha-conexao').hidden = false;
  } finally { enviando = false; await mostrarFila(); }
});

function renderizarComunicacao(focar=false) {
  if (!catalogo) return;
  if (perfilTea() && !catalogo.categorias.some(c => c.id === categoriaAtual)) categoriaAtual = catalogo.categorias[0]?.id || null;
  renderizarCategoriasTea();
  const categoria = catalogo.categorias.find(c => c.id === categoriaAtual);
  const maisCognitivas = perfilCognitivo() && categoriaAtual === 'mais_mensagens';
  $('titulo-comunicacao').textContent = perfilCognitivo() ? (maisCognitivas ? 'Mais mensagens' : 'O que você precisa?') : (categoria ? categoria.rotulo : 'O que você quer comunicar?');
  $('descricao-comunicacao').textContent = perfilCognitivo() ? 'Escolha uma mensagem.' : (categoria ? 'Toque na mensagem que você quer escolher.' : 'Escolha uma categoria ou peça ajuda.');
  $('inicio-comunicacao').hidden = perfilCognitivo() ? !maisCognitivas : (!categoria || baixaVisao() || perfilTea());
  $('mais-mensagens').hidden = !perfilCognitivo() || maisCognitivas;
  $('opcoes-comunicacao').classList.toggle('em-categoria',Boolean(categoria));
  fecharConfirmacao();
  const fragmento = document.createDocumentFragment();
  const todas = opcoesAtuais();
  indiceOpcao = Math.max(0,Math.min(indiceOpcao,todas.length-1));
  const opcoes = baixaVisao() ? todas.slice(indiceOpcao,indiceOpcao+1) : todas;
  $('paginacao-baixa-visao').hidden = !baixaVisao();
  $('posicao-opcao').textContent = (categoria ? 'Mensagem ' : 'Categoria ') + (indiceOpcao+1) + ' de ' + todas.length;
  $('opcao-anterior').disabled = indiceOpcao === 0;
  $('opcao-proxima').disabled = indiceOpcao === todas.length-1;
  for (const opcao of opcoes) {
    const mensagem = typeof opcao.frase === 'string';
    const botao = document.createElement('button'); botao.type = 'button';
    botao.className = 'opcao-comunicacao' + (opcao.id === 'ajuda' ? ' ajuda' : '');
    const texto = document.createElement('span'); texto.className = 'texto-opcao';
    const titulo = document.createElement('strong'); titulo.textContent = opcao.rotulo;
    const descricao = document.createElement('small'); descricao.textContent = mensagem ? opcao.frase : opcao.descricao;
    texto.append(titulo); if (!perfilCognitivo()) texto.append(descricao);
    botao.append(desenho(opcao.icone),texto);
    if (mensagem) {
      botao.dataset.mensagem = opcao.id; botao.setAttribute('aria-pressed','false'); botao.setAttribute('aria-label',opcao.rotulo + ': ' + opcao.frase);
      botao.addEventListener('click',() => selecionarMensagem(opcao));
    } else {
      botao.dataset.categoria = opcao.id;
      botao.addEventListener('click',() => { categoriaAtual = opcao.id; indiceOpcao = 0; renderizarComunicacao(true); falarOpcao(opcao.rotulo); });
    }
    fragmento.append(botao);
  }
  $('opcoes-comunicacao').replaceChildren(fragmento);
  if (focar) $('titulo-comunicacao').focus({preventScroll:true});
}

$('inicio-comunicacao').addEventListener('click',() => { categoriaAtual = null; renderizarComunicacao(true); });

function limparIdentidade() {
  fecharConfirmacao();
  aplicarPerfil('padrao');
  $('resultado-envio').hidden = true; $('resultado-envio').textContent = ''; delete $('resultado-envio').dataset.situacao;
  alunoAtualId = null; categoriaAtual = null;
  $('opcoes-comunicacao').replaceChildren();
  $('nome-aluno').textContent = ''; $('nome-comunicador').textContent = '';
  $('foto').hidden = true; $('foto').removeAttribute('src'); $('iniciais').textContent = '';
  $('identidade').hidden = true; $('vinculo-pendente').hidden = true;
  $('comunicador-pendente').textContent = ''; $('titulo-pendente').textContent = ''; $('descricao-pendente').textContent = '';
  mostrarFila();
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
  if (ocupado || enviando) return;
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
    if (alunoAtualId !== aluno.id || perfilAtual !== aluno.perfil_acessibilidade) {
      alunoAtualId = aluno.id; categoriaAtual = null; aplicarPerfil(aluno.perfil_acessibilidade); renderizarComunicacao();
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
  if (ocupado || enviando) return;
  ocupado = true;
  const atual = geracao;
  $('atualizar').disabled = true;
  try {
    if (naEntrada) { await carregarEntrada(); return; }
    const contexto = await api('/api/aluno/perfil');
    const opcoes = contexto.situacao === 'vinculado' && !catalogo ? await api('/api/aluno/catalogo') : catalogo;
    if (atual === geracao && !enviando) { catalogo = opcoes; exibirContexto(contexto); await mostrarFila(); }
  } catch (erro) {
    if (atual !== geracao || enviando) return;
    if (erro.status === 401) { exibirEntrada(); await carregarEntrada(); }
    else {
      // Preserva a tela já carregada para compor offline; a identidade será revalidada no envio.
      $('carregando').hidden = true;
      $('falha-conexao').textContent = 'Sem conexão. Você pode guardar mensagens do aluno já selecionado; elas ainda não chegaram à tutora.'; $('falha-conexao').hidden = false;
      $('acoes').hidden = false;
    }
  } finally { if (atual === geracao) { ocupado = false; $('atualizar').disabled = false; } }
  await sincronizarFila();
}

$('atualizar').addEventListener('click',atualizar);
$('foto').addEventListener('error', () => { $('foto').hidden = true; $('foto').removeAttribute('src'); });
$('trocar-aluno').addEventListener('click',async () => {
  if (ocupado || enviando) return;
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
window.addEventListener('online',() => { proximaTentativa = 0; atualizar(); });
window.addEventListener('offline',() => {
  $('falha-conexao').textContent = 'Sem conexão. As mensagens confirmadas ficam guardadas até o envio.';
  $('falha-conexao').hidden = false;
});
setInterval(() => { if (!document.hidden) sincronizarFila(); },5000);
mostrarFila();
document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); else pararVoz(); });
