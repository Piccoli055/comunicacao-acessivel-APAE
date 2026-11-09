'use strict';

const $ = id => document.getElementById(id);
let conectado = false, sessao = 0, pedidos = [], vistos = new Set(), primeiraCarga = true;
let visao = 'pendentes', assinatura = '', consulta = null, somAtivo = false, audio = null;
let toastTimer = null;
const requisicoes = new Set();
const nomes = {novo: 'Novo', recebido: 'Recebido', atendido: 'Atendido'};

class FalhaAPI extends Error {
  constructor(mensagem, status = 0) { super(mensagem); this.status = status; }
}

async function api(rota, dados) {
  const controller = new AbortController();
  requisicoes.add(controller);
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const resposta = await fetch(rota, {
      method: dados ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: {'X-Portal': 'tutora', ...(dados ? {'Content-Type': 'application/json'} : {})},
      ...(dados ? {body: JSON.stringify(dados)} : {}), signal: controller.signal,
      cache: 'no-store',
    });
    const resultado = await resposta.json();
    if (!resposta.ok) throw new FalhaAPI(resultado.erro || 'Não foi possível concluir. Tente novamente.', resposta.status);
    return resultado;
  } catch (erro) {
    if (erro instanceof FalhaAPI) throw erro;
    throw new FalhaAPI('Não foi possível conectar. Confira o Wi-Fi e se o servidor está ligado.');
  } finally {
    clearTimeout(timeout); requisicoes.delete(controller);
  }
}

function avisar(texto) {
  $('toast').textContent = texto;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}

function conexao(online, erro = '') {
  $('estado-conexao').textContent = online ? 'Conectado' : 'Sem conexão';
  $('luz-conexao').classList.toggle('offline', !online);
  $('aviso-conexao').hidden = online;
  $('aviso-conexao').textContent = erro ? erro + ' Os pedidos já carregados continuam visíveis. Tentaremos novamente automaticamente.' : '';
}

function elemento(tag, classe, texto) {
  const node = document.createElement(tag);
  if (classe) node.className = classe;
  if (texto !== undefined) node.textContent = texto;
  return node;
}

function resumo() {
  for (const [estado, id] of [['novo', 'total-novos'], ['recebido', 'total-recebidos'], ['atendido', 'total-atendidos']]) {
    $(id).textContent = pedidos.filter(p => p.estado === estado).length;
  }
  $('badge-pendentes').textContent = pedidos.filter(p => p.estado !== 'atendido').length;
  const selecionado = $('dispositivo').value;
  const dispositivos = [...new Set(pedidos.map(p => p.dispositivo))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  // Não remover o filtro selecionado enquanto um pedido expira.
  if (selecionado && !dispositivos.includes(selecionado)) dispositivos.push(selecionado);
  const atuais = Array.from($('dispositivo').options).slice(1).map(o => o.value);
  if (JSON.stringify(atuais) !== JSON.stringify(dispositivos)) {
    const primeiro = elemento('option', '', 'Todos os comunicadores'); primeiro.value = '';
    $('dispositivo').replaceChildren(primeiro, ...dispositivos.map(nome => {
      const option = elemento('option', '', nome); option.value = nome; return option;
    }));
    $('dispositivo').value = selecionado;
  }
}

function registroHistorico(pedido) {
  const registro = elemento('article', 'registro-historico');
  const mensagem = elemento('div', 'registro-mensagem');
  mensagem.append(elemento('h2', '', pedido.frase));
  if (pedido.prioridade === 'ajuda') mensagem.append(elemento('span', 'selo ajuda', 'Pedido de ajuda'));
  const comunicador = elemento('div', 'registro-comunicador');
  comunicador.append(elemento('small', 'rotulo-registro', 'Comunicador'), elemento('span', '', pedido.dispositivo));
  const situacao = elemento('div', 'registro-situacao');
  situacao.append(elemento('small', 'rotulo-registro', 'Situação'), elemento('span', 'selo ' + pedido.estado, nomes[pedido.estado]));
  const recebimento = elemento('div', 'registro-recebimento');
  const horario = elemento('time', '', new Date(pedido.recebido).toLocaleString('pt-BR', {
    day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit',
  }));
  horario.dateTime = pedido.recebido;
  recebimento.append(elemento('small', 'rotulo-registro', 'Recebimento'), horario);
  registro.append(mensagem, comunicador, situacao, recebimento);
  return registro;
}

function renderizar(forcar = false) {
  resumo();
  const busca = $('busca').value.trim().toLocaleLowerCase('pt-BR');
  const comunicador = $('dispositivo').value, situacao = $('filtro-estado').value;
  let lista = pedidos.filter(p => (visao === 'historico' || p.estado !== 'atendido')
    && (!comunicador || p.dispositivo === comunicador)
    && (!situacao || p.estado === situacao)
    && (!busca || (p.frase + ' ' + p.dispositivo).toLocaleLowerCase('pt-BR').includes(busca)));
  if (visao === 'historico') lista = lista.slice().reverse();
  const novaAssinatura = JSON.stringify([visao, lista]);
  if (novaAssinatura === assinatura) return;
  if (!forcar && $('pedidos').contains(document.activeElement)) {
    $('texto-novos').textContent = 'Há atualizações na lista. Atualize quando terminar sua ação.';
    $('aviso-novos').hidden = false;
    return;
  }
  assinatura = novaAssinatura;
  $('aviso-novos').hidden = true;
  const fragmento = document.createDocumentFragment();
  for (const pedido of lista) {
    if (visao === 'historico') {
      fragmento.append(registroHistorico(pedido));
      continue;
    }
    const card = elemento('article', 'pedido' + (pedido.prioridade === 'ajuda' ? ' ajuda' : ''));
    const simbolo = elemento('div', 'pedido-icone', pedido.prioridade === 'ajuda' ? '!' : '↗');
    simbolo.setAttribute('aria-hidden', 'true');
    const corpo = elemento('div', 'pedido-corpo');
    const selos = elemento('div', 'pedido-selos');
    selos.append(elemento('span', 'selo ' + pedido.estado, nomes[pedido.estado]));
    if (pedido.prioridade === 'ajuda') selos.append(elemento('span', 'selo ajuda', 'Pedido de ajuda'));
    const titulo = elemento('h2', '', pedido.frase);
    const meta = elemento('div', 'pedido-meta');
    const horario = new Date(pedido.recebido);
    const tempo = elemento('time', '', horario.toLocaleString('pt-BR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'}));
    tempo.dateTime = pedido.recebido;
    meta.append(elemento('span', 'identificacao', pedido.dispositivo), tempo);
    corpo.append(selos, titulo, meta);
    if (pedido.estado !== 'novo') {
      const quando = new Date(pedido.atualizado).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
      corpo.append(elemento('div', 'pedido-tempo', (pedido.estado === 'atendido' ? 'Atendido' : 'Recebimento confirmado') + ' às ' + quando));
    }
    card.append(simbolo, corpo);
    if (pedido.estado !== 'atendido') {
      const botao = elemento('button', 'botao acao ' + (pedido.estado === 'novo' ? 'principal' : 'secundaria'),
        pedido.estado === 'novo' ? 'Confirmar recebimento' : 'Marcar como atendido');
      botao.setAttribute('aria-label', botao.textContent + ': ' + pedido.frase + ' — ' + pedido.dispositivo);
      botao.addEventListener('click', () => alterarPedido(pedido, botao));
      card.append(botao);
    }
    fragmento.append(card);
  }
  $('pedidos').replaceChildren(fragmento);
  $('pedidos').setAttribute('aria-busy', 'false');
  $('quantidade-lista').textContent = lista.length + (visao === 'historico'
    ? (lista.length === 1 ? ' chamado' : ' chamados')
    : (lista.length === 1 ? ' pedido' : ' pedidos'));
  $('vazio').hidden = lista.length !== 0;
  if (!lista.length) {
    const filtrado = Boolean(busca || comunicador || situacao);
    $('vazio-titulo').textContent = filtrado ? 'Nenhum pedido encontrado' : visao === 'historico' ? 'Nenhum chamado no histórico' : 'Tudo tranquilo por aqui';
    $('vazio-texto').textContent = filtrado ? 'Experimente outro comunicador, situação ou termo de busca.' : visao === 'historico' ? 'Os chamados aparecerão aqui em qualquer situação. Os atendidos saem 48 horas após o atendimento.' : 'Os novos pedidos aparecerão neste espaço.';
  }
}

function aplicarPedidos(lista) {
  const novos = primeiraCarga ? [] : lista.filter(p => !vistos.has(p.id) && p.estado === 'novo');
  pedidos = lista;
  vistos = new Set(lista.map(p => p.id));
  primeiraCarga = false;
  conexao(true);
  renderizar();
  if (novos.length) {
    $('anuncio').textContent = novos.length === 1 ? 'Novo pedido de ' + novos[0].dispositivo + ': ' + novos[0].frase : novos.length + ' novos pedidos recebidos.';
    if (somAtivo) tocar();
  }
}

async function atualizar() {
  if (!conectado) return;
  if (consulta) return consulta;
  const atual = sessao;
  consulta = (async () => {
    try {
      const lista = await api('/api/pedidos');
      if (atual === sessao && conectado) aplicarPedidos(lista);
    } catch (erro) {
      if (atual !== sessao || !conectado) return;
      if (erro.status === 401) {
        limparSessao(false);
        $('erro').textContent = 'Sua sessão terminou. Entre novamente.';
        $('senha').focus();
      } else conexao(false, erro.message);
    }
  })();
  const operacao = consulta;
  await operacao;
  if (consulta === operacao) consulta = null;
}

async function alterarPedido(pedido, botao) {
  const atual = sessao;
  botao.disabled = true;
  botao.textContent = 'Salvando…';
  let salvo = false;
  try {
    await api(pedido.estado === 'novo' ? '/api/confirmar' : '/api/atender', {id:pedido.id});
    if (atual !== sessao || !conectado) return;
    salvo = true;
    // Esperar uma consulta anterior antes de buscar o estado confirmado.
    if (consulta) await consulta;
    if (atual !== sessao || !conectado) return;
    const lista = await api('/api/pedidos');
    if (atual !== sessao || !conectado) return;
    aplicarPedidos(lista);
    renderizar(true);
    avisar(pedido.estado === 'novo' ? 'Recebimento confirmado.' : 'Pedido marcado como atendido.');
    $('quantidade-lista').setAttribute('tabindex', '-1');
    $('quantidade-lista').focus({preventScroll:true});
  } catch (erro) {
    if (atual === sessao && conectado) {
      avisar(salvo ? 'Ação salva. Não foi possível atualizar a lista agora.' : erro.message);
      if (erro.status === 404) { assinatura = ''; await atualizar(); renderizar(true); }
    }
  } finally {
    if (botao.isConnected) {
      botao.disabled = false;
      botao.textContent = pedido.estado === 'novo' ? 'Confirmar recebimento' : 'Marcar como atendido';
    }
  }
}

async function tocar() {
  try {
    if (!audio) return;
    if (audio.state === 'suspended') await audio.resume();
    const inicio = audio.currentTime;
    for (const [atraso, freq] of [[0,660],[0.19,880]]) {
      const osc = audio.createOscillator(), ganho = audio.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      ganho.gain.setValueAtTime(0, inicio + atraso);
      ganho.gain.linearRampToValueAtTime(.13, inicio + atraso + .02);
      ganho.gain.exponentialRampToValueAtTime(.001, inicio + atraso + .17);
      osc.connect(ganho); ganho.connect(audio.destination);
      osc.start(inicio + atraso); osc.stop(inicio + atraso + .18);
    }
  } catch (_) {
    somAtivo = false; atualizarSom(); avisar('Não foi possível tocar o aviso. Ative o som novamente.');
  }
}

function atualizarSom() {
  $('som').textContent = somAtivo ? 'Aviso sonoro ativado' : 'Ativar aviso sonoro';
  $('som').setAttribute('aria-pressed', String(somAtivo));
}

function limparSessao(focar = true) {
  sessao++; conectado = false; consulta = null;
  requisicoes.forEach(r => r.abort()); requisicoes.clear();
  pedidos = []; vistos.clear(); primeiraCarga = true; assinatura = '';
  somAtivo = false; atualizarSom();
  if (audio) { audio.close().catch(() => {}); audio = null; }
  clearTimeout(toastTimer);
  $('senha').value = ''; $('senha').type = 'password';
  $('mostrar-senha').textContent = 'Mostrar';
  $('mostrar-senha').setAttribute('aria-pressed', 'false');
  $('mostrar-senha').setAttribute('aria-label', 'Mostrar senha');
  $('perfil-usuario').textContent = '';
  $('portal').hidden = true; $('entrada').hidden = false; $('pular').hidden = true;
  $('pedidos').replaceChildren(); $('toast').hidden = true;
  $('aviso-novos').hidden = true; $('anuncio').textContent = '';
  $('conectar').disabled = false; $('conectar').textContent = 'Entrar no portal →';
  $('dispositivo').replaceChildren(new Option('Todos os comunicadores', ''));
  $('busca').value = ''; mudarVisao('pendentes', false);
  if (focar) $('instituicao').focus();
}

function mudarVisao(nova, desenhar = true) {
  visao = nova; assinatura = '';
  for (const id of ['pendentes','historico']) {
    $('nav-' + id).classList.toggle('selecionado', id === nova);
    if (id === nova) $('nav-' + id).setAttribute('aria-current','page');
    else $('nav-' + id).removeAttribute('aria-current');
  }
  $('titulo-pagina').textContent = nova === 'pendentes' ? 'Pedidos pendentes' : 'Histórico de chamados';
  $('resumo-pedidos').hidden = nova === 'historico';
  $('pedidos').classList.toggle('historico', nova === 'historico');
  $('cabecalho-historico').hidden = nova !== 'historico';
  $('descricao-pagina').textContent = nova === 'pendentes' ? 'Acompanhe o que precisa da sua atenção.' : 'Consulte e filtre os chamados. Os atendidos permanecem por 48 horas após o atendimento.';
  $('ordem-lista').textContent = nova === 'pendentes' ? 'Mais antigos primeiro' : 'Pedidos mais recentes primeiro';
  const situacoes = [['','Todas as situações'],['novo','Novos'],['recebido','Recebidos']];
  if (nova === 'historico') situacoes.push(['atendido','Atendidos']);
  $('filtro-estado').replaceChildren(...situacoes.map(([valor, texto]) => new Option(texto,valor)));
  $('filtro-estado').value = '';
  if (desenhar) renderizar(true);
}

function abrirPortal(perfil, lista) {
  conectado = true;
  $('senha').value = '';
  $('entrada').hidden = true; $('portal').hidden = false; $('pular').hidden = false;
  $('perfil-usuario').textContent = perfil.usuario + (perfil.perfil === 'admdev' ? ' · ADM Desenvolvedor' : ' · Tutora');
  $('pedidos').setAttribute('aria-busy', 'true');
  aplicarPedidos(lista);
  $('conteudo').focus();
}
$('acesso').addEventListener('submit', async evento => {
  evento.preventDefault();
  if (location.protocol === 'file:') { $('erro').textContent = 'Abra o portal pelo endereço do servidor, por exemplo http://127.0.0.1:8765, em vez de abrir este arquivo.'; return; }
  const credenciais = {instituicao: $('instituicao').value.trim(), usuario: $('usuario').value.trim(), senha: $('senha').value};
  const atual = ++sessao;
  $('erro').textContent = ''; $('conectar').disabled = true; $('conectar').textContent = 'Entrando…';
  try {
    const perfil = await api('/api/login', credenciais);
    if (atual !== sessao) return;
    const lista = await api('/api/pedidos');
    if (atual !== sessao) return;
    abrirPortal(perfil, lista);
  } catch (erro) {
    if (atual === sessao) { conectado = false; $('erro').textContent = erro.message; }
  } finally {
    credenciais.senha = ''; $('senha').value = '';
    if (atual === sessao) { $('conectar').disabled = false; $('conectar').textContent = 'Entrar no portal →'; }
  }
});
$('mostrar-senha').addEventListener('click', () => {
  const mostrar = $('senha').type === 'password';
  $('senha').type = mostrar ? 'text' : 'password';
  $('mostrar-senha').textContent = mostrar ? 'Ocultar' : 'Mostrar';
  $('mostrar-senha').setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
  $('mostrar-senha').setAttribute('aria-pressed', String(mostrar));
});
$('sair').addEventListener('click', async () => {
  $('sair').disabled = true;
  try { await api('/api/logout', {}); limparSessao(); }
  catch (erro) { avisar('Não foi possível encerrar a sessão no servidor. Confira a conexão e tente sair novamente.'); }
  finally { $('sair').disabled = false; }
});
async function restaurarSessao() {
  const atual = sessao;
  if (location.protocol === 'file:') return;
  try {
    const perfil = await api('/api/sessao');
    const lista = await api('/api/pedidos');
    if (atual === sessao && !conectado) abrirPortal(perfil, lista);
  } catch (_) { /* Sem sessão: manter a tela de entrada. */ }
}
restaurarSessao();
$('nav-pendentes').addEventListener('click', () => mudarVisao('pendentes'));
$('nav-historico').addEventListener('click', () => mudarVisao('historico'));
for (const id of ['dispositivo','filtro-estado']) $(id).addEventListener('change', () => renderizar(true));
$('busca').addEventListener('input', () => renderizar(true));
$('ver-novos').addEventListener('click', () => renderizar(true));
$('som').addEventListener('click', async () => {
  if (somAtivo) { somAtivo = false; atualizarSom(); return; }
  const atual = sessao;
  try {
    const Contexto = window.AudioContext || window.webkitAudioContext;
    if (!Contexto) throw Error();
    if (!audio) audio = new Contexto();
    await audio.resume();
    if (atual !== sessao || !conectado) return;
    somAtivo = true; atualizarSom(); await tocar();
    avisar('Som ativado. Mantenha o portal aberto para receber os avisos.');
  } catch (_) { avisar('Este navegador não conseguiu ativar o som. Os avisos visuais continuam ativos.'); }
});
setInterval(atualizar, 2000);
window.addEventListener('online', atualizar);
window.addEventListener('offline', () => { if (conectado) conexao(false,'Confira a conexão Wi-Fi.'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });
