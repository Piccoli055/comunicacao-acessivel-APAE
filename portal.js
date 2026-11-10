'use strict';

const $ = id => document.getElementById(id);
let conectado = false, sessao = 0, pedidos = [], vistos = new Set(), primeiraCarga = true;
let visao = 'pendentes', assinatura = '', consulta = null, somAtivo = false, audio = null;
let toastTimer = null;
let alunos = [], alunosCarregados = false, consultaAlunos = null;
let fotoAlunoURL = null, alunoEdicao = null, novoAlunoId = null, removerFoto = false;
let geracaoFormulario = 0, salvandoAluno = false, ultimaConsultaAlunos = 0;
let comunicadores = [], consultaComunicadores = null, comunicadoresCarregados = false;
let vinculoBase = null, salvandoVinculo = false;
const perfisAlunos = {padrao: 'Padrão', tea: 'TEA', motora: 'Acessibilidade motora', baixa_visao: 'Baixa visão', intelectual: 'Acessibilidade cognitiva'};
const requisicoes = new Set();
const nomes = {novo: 'Novo', recebido: 'Recebido', atendido: 'Atendido'};

class FalhaAPI extends Error {
  constructor(mensagem, status = 0) { super(mensagem); this.status = status; }
}

async function api(rota, dados) {
  const controller = new AbortController();
  requisicoes.add(controller);
  const timeout = setTimeout(() => controller.abort(), rota.startsWith('/api/alunos') ? 15000 : 6000);
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

function atualizarFiltroAluno() {
  const selecionado = $('filtro-aluno').value;
  const nomesPorId = new Map();
  // Os chamados mantêm alunos do histórico; o cadastro fornece o nome atual.
  for (const pedido of pedidos) {
    if (pedido.aluno_id) nomesPorId.set(pedido.aluno_id, pedido.aluno_nome || 'Aluno sem nome');
  }
  for (const aluno of alunos) nomesPorId.set(aluno.id, aluno.nome + (aluno.ativo ? '' : ' (inativo)'));
  // Expiração e atualização não devem ampliar silenciosamente a consulta.
  if (selecionado && selecionado !== '__sem_aluno__' && !nomesPorId.has(selecionado)) {
    nomesPorId.set(selecionado, 'Aluno selecionado (sem pedidos disponíveis)');
  }
  const opcoes = [['','Todos os alunos'],['__sem_aluno__','Sem aluno identificado'],
    ...[...nomesPorId].sort((a,b) => a[1].localeCompare(b[1], 'pt-BR') || a[0].localeCompare(b[0]))];
  const atuais = Array.from($('filtro-aluno').options).map(o => [o.value,o.textContent]);
  if (JSON.stringify(atuais) !== JSON.stringify(opcoes)) {
    $('filtro-aluno').replaceChildren(...opcoes.map(([id,nome]) => new Option(nome,id)));
    $('filtro-aluno').value = selecionado;
  }
}

function resumo() {
  atualizarFiltroAluno();
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

function nomeAlunoPedido(pedido) {
  return pedido.aluno_id && pedido.aluno_nome ? pedido.aluno_nome : 'Aluno não identificado';
}

function avatarAlunoPedido(pedido) {
  const nome = nomeAlunoPedido(pedido);
  const iniciais = pedido.aluno_id && pedido.aluno_nome
    ? nome.trim().split(/\s+/u).slice(0, 2).map(parte => Array.from(parte)[0]).join('').toLocaleUpperCase('pt-BR')
    : '?';
  const avatar = elemento('span', 'aluno-avatar avatar-pedido', iniciais);
  avatar.setAttribute('aria-hidden', 'true');
  if (pedido.aluno_id && pedido.aluno_foto_url) {
    const foto = elemento('img', 'foto-aluno');
    foto.alt = ''; foto.src = pedido.aluno_foto_url;
    foto.addEventListener('error', () => foto.remove());
    avatar.append(foto);
  }
  return avatar;
}

function registroHistorico(pedido) {
  const registro = elemento('article', 'registro-historico');
  const mensagem = elemento('div', 'registro-mensagem');
  mensagem.append(elemento('h2', '', pedido.frase));
  if (pedido.prioridade === 'ajuda') mensagem.append(elemento('span', 'selo ajuda', 'Pedido de ajuda'));
  const comunicador = elemento('div', 'registro-comunicador');
  const identificacao = elemento('div', 'identidade-historico');
  const dadosAluno = elemento('div', 'dados-identidade');
  dadosAluno.append(elemento('span', 'aluno-pedido-nome', nomeAlunoPedido(pedido)), elemento('small', 'comunicador-pedido', pedido.dispositivo));
  identificacao.append(avatarAlunoPedido(pedido), dadosAluno);
  comunicador.append(elemento('small', 'rotulo-registro', 'Aluno / comunicador'), identificacao);
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
  if (visao === 'alunos' || visao === 'comunicadores') return;
  const busca = $('busca').value.trim().toLocaleLowerCase('pt-BR');
  const comunicador = $('dispositivo').value, situacao = $('filtro-estado').value;
  const alunoSelecionado = $('filtro-aluno').value;
  let lista = pedidos.filter(p => (visao === 'historico' || p.estado !== 'atendido')
    && (!comunicador || p.dispositivo === comunicador)
    && (!situacao || p.estado === situacao)
    && (!alunoSelecionado || (alunoSelecionado === '__sem_aluno__' ? !p.aluno_id : p.aluno_id === alunoSelecionado))
    && (!busca || (p.frase + ' ' + p.dispositivo + ' ' + nomeAlunoPedido(p)).toLocaleLowerCase('pt-BR').includes(busca)));
  if (visao === 'historico') lista = lista.slice().reverse();
  const novaAssinatura = JSON.stringify([visao, comunicador, situacao, alunoSelecionado, busca, lista]);
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
    const simbolo = avatarAlunoPedido(pedido);
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
    corpo.append(elemento('p', 'aluno-pedido-nome', nomeAlunoPedido(pedido)), selos, titulo, meta);
    if (pedido.estado !== 'novo') {
      const quando = new Date(pedido.atualizado).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
      corpo.append(elemento('div', 'pedido-tempo', (pedido.estado === 'atendido' ? 'Atendido' : 'Recebimento confirmado') + ' às ' + quando));
    }
    card.append(simbolo, corpo);
    if (pedido.estado !== 'atendido') {
      const botao = elemento('button', 'botao acao ' + (pedido.estado === 'novo' ? 'principal' : 'secundaria'),
        pedido.estado === 'novo' ? 'Confirmar recebimento' : 'Marcar como atendido');
      botao.setAttribute('aria-label', botao.textContent + ': ' + nomeAlunoPedido(pedido) + ' — ' + pedido.frase + ' — ' + pedido.dispositivo);
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
    const filtrado = Boolean(busca || comunicador || situacao || alunoSelecionado);
    $('vazio-titulo').textContent = filtrado ? 'Nenhum pedido encontrado' : visao === 'historico' ? 'Nenhum chamado no histórico' : 'Tudo tranquilo por aqui';
    $('vazio-texto').textContent = filtrado ? 'Experimente outro aluno, comunicador, situação ou termo de busca.' : visao === 'historico' ? 'Os chamados aparecerão aqui em qualquer situação. Os atendidos saem 48 horas após o atendimento.' : 'Os novos pedidos aparecerão neste espaço.';
  }
}

function atualizarPreviaAluno() {
  const nome = $('aluno-nome').value.trim();
  $('aluno-nome').setCustomValidity(nome ? '' : 'Informe o nome do aluno.');
  $('previa-aluno-nome').textContent = nome || 'Nome do aluno';
  $('previa-aluno-iniciais').textContent = nome ? nome.split(/\s+/u).slice(0, 2).map(parte => Array.from(parte)[0]).join('').toLocaleUpperCase('pt-BR') : '?';
  $('previa-aluno-perfil').textContent = perfisAlunos[$('aluno-perfil').value] || 'Padrão';
  $('resultado-formulario-aluno').textContent = '';
}

function limparFotoAluno(limparCampo = true) {
  $('previa-aluno-foto').hidden = true;
  $('previa-aluno-foto').removeAttribute('src');
  if (fotoAlunoURL) URL.revokeObjectURL(fotoAlunoURL);
  fotoAlunoURL = null;
  if (limparCampo) $('aluno-foto').value = '';
  $('aluno-foto').setCustomValidity('');
  $('previa-aluno-iniciais').hidden = false;
  $('remover-foto-aluno').hidden = true;
  $('erro-aluno-foto').hidden = true;
  $('erro-aluno-foto').textContent = '';
  $('aluno-foto').removeAttribute('aria-invalid');
  $('resultado-formulario-aluno').textContent = '';
  removerFoto = true;
}

function selecionarFotoAluno() {
  const arquivo = $('aluno-foto').files[0];
  limparFotoAluno(false);
  if (!arquivo) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(arquivo.type) || arquivo.size <= 0 || arquivo.size > 5 * 1024 * 1024) {
    $('erro-aluno-foto').textContent = 'Selecione uma foto JPEG, PNG ou WebP de até 5 MB.';
    $('erro-aluno-foto').hidden = false;
    $('aluno-foto').setAttribute('aria-invalid', 'true');
    $('aluno-foto').setCustomValidity('Selecione uma foto válida ou remova a seleção.');
    $('remover-foto-aluno').hidden = false;
    return;
  }
  // A prévia local é liberada ao trocar de imagem, cancelar ou encerrar a sessão.
  removerFoto = false;
  fotoAlunoURL = URL.createObjectURL(arquivo);
  $('previa-aluno-foto').src = fotoAlunoURL;
  $('previa-aluno-foto').hidden = false;
  $('previa-aluno-iniciais').hidden = true;
  $('remover-foto-aluno').hidden = false;
}

function fecharFormularioAluno(focar = true) {
  geracaoFormulario++; salvandoAluno = false;
  limparFotoAluno();
  alunoEdicao = null; novoAlunoId = null; removerFoto = false;
  $('campos-cadastro-aluno').disabled = false;
  $('salvar-aluno').textContent = 'Salvar cadastro';
  $('erro-formulario-aluno').textContent = ''; $('erro-formulario-aluno').hidden = true;
  $('formulario-aluno').reset();
  $('aluno-nome').setCustomValidity('');
  $('aluno-perfil').value = 'padrao';
  atualizarPreviaAluno();
  $('formulario-aluno').hidden = true;
  $('novo-aluno').disabled = false;
  $('novo-aluno').setAttribute('aria-expanded', 'false');
  if (focar) $('novo-aluno').focus();
}

function abrirFormularioAluno(aluno = null) {
  if (!conectado || salvandoAluno) return;
  fecharFormularioAluno(false);
  alunoEdicao = aluno;
  novoAlunoId = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
  $('titulo-formulario-aluno').textContent = aluno ? 'Editar aluno' : 'Novo aluno';
  $('salvar-aluno').textContent = aluno ? 'Salvar alterações' : 'Salvar cadastro';
  $('aluno-nome').value = aluno ? aluno.nome : '';
  $('aluno-perfil').value = aluno ? aluno.perfil_acessibilidade : 'padrao';
  $('aluno-autorizado').checked = Boolean(aluno && aluno.autorizado_em);
  $('previa-aluno-situacao').textContent = aluno ? (aluno.ativo ? 'Ativo' : 'Inativo') : 'Ativo ao cadastrar';
  $('previa-aluno-situacao').className = 'selo ' + (aluno && !aluno.ativo ? 'inativo' : 'atendido');
  removerFoto = false;
  if (aluno && aluno.foto_url) {
    $('previa-aluno-foto').src = aluno.foto_url;
    $('previa-aluno-foto').hidden = false;
    $('previa-aluno-iniciais').hidden = true;
    $('remover-foto-aluno').hidden = false;
  }
  $('formulario-aluno').hidden = false;
  $('novo-aluno').disabled = true;
  $('novo-aluno').setAttribute('aria-expanded', 'true');
  atualizarPreviaAluno();
  $('aluno-nome').focus();
}

function renderizarAlunos() {
  const fragmento = document.createDocumentFragment();
  for (const aluno of alunos) {
    const linha = elemento('li', 'aluno');
    const avatar = elemento('span', 'aluno-avatar', aluno.nome.trim().split(/\s+/u).slice(0, 2).map(parte => Array.from(parte)[0]).join('').toLocaleUpperCase('pt-BR'));
    avatar.setAttribute('aria-hidden', 'true');
    if (aluno.foto_url) {
      const foto = elemento('img', 'foto-aluno');
      foto.alt = ''; foto.src = aluno.foto_url;
      foto.addEventListener('error', () => { foto.remove(); });
      avatar.append(foto);
    }
    const dados = elemento('div', 'aluno-dados');
    dados.append(elemento('h2', '', aluno.nome), elemento('p', '', 'Perfil de acessibilidade: ' + (perfisAlunos[aluno.perfil_acessibilidade] || 'Padrão')));
    const situacao = elemento('span', 'selo ' + (aluno.ativo ? 'atendido' : 'inativo'), aluno.ativo ? 'Ativo' : 'Inativo');
    const acoes = elemento('div', 'acoes-cadastro');
    for (const [texto, acao] of [
      ['Editar', () => abrirFormularioAluno(aluno)],
      [aluno.ativo ? 'Desativar' : 'Reativar', botao => mudarSituacaoAluno(aluno, botao)],
      ['Excluir', botao => excluirAluno(aluno, botao)],
    ]) {
      const botao = elemento('button', 'botao-texto', texto);
      botao.type = 'button';
      botao.setAttribute('aria-label', texto + ' aluno: ' + aluno.nome);
      botao.addEventListener('click', () => acao(botao));
      acoes.append(botao);
    }
    linha.append(avatar, dados, situacao, acoes);
    fragmento.append(linha);
  }
  $('lista-alunos').replaceChildren(fragmento);
  $('quantidade-alunos').textContent = alunos.length + (alunos.length === 1 ? ' aluno cadastrado' : ' alunos cadastrados');
  $('vazio-alunos').hidden = alunos.length !== 0;
  $('total-alunos').textContent = alunos.length;
  atualizarFiltroAluno();
  renderizarOpcoesVinculo();
}

async function atualizarAlunos() {
  if (!conectado) return;
  if (consultaAlunos) return consultaAlunos;
  const atual = sessao;
  $('lista-alunos').setAttribute('aria-busy', 'true');
  $('atualizar-alunos').disabled = true;
  $('erro-alunos').hidden = true;
  if (!alunosCarregados) {
    $('quantidade-alunos').textContent = 'Carregando alunos…';
    $('vazio-alunos').hidden = true;
  }
  consultaAlunos = (async () => {
    try {
      const lista = await api('/api/alunos');
      if (atual !== sessao || !conectado) return;
      alunos = lista;
      alunosCarregados = true;
      ultimaConsultaAlunos = Date.now();
      renderizarAlunos();
    } catch (erro) {
      if (atual !== sessao || !conectado) return;
      if (erro.status === 401) {
        limparSessao(false);
        $('erro').textContent = 'Sua sessão terminou. Entre novamente.';
        $('senha').focus();
      } else {
        $('erro-alunos').textContent = erro.message + (alunosCarregados ? ' A lista anterior continua visível.' : ' Use Atualizar alunos para tentar novamente.');
        $('erro-alunos').hidden = false;
        if (!alunosCarregados) $('quantidade-alunos').textContent = 'Lista indisponível';
      }
    } finally {
      if (atual === sessao) {
        $('lista-alunos').setAttribute('aria-busy', 'false');
        $('atualizar-alunos').disabled = false;
      }
    }
  })();
  const operacao = consultaAlunos;
  await operacao;
  if (consultaAlunos === operacao) consultaAlunos = null;
}

function renderizarOpcoesVinculo() {
  const selecionado = $('vinculo-aluno').value;
  const opcoes = [new Option('Sem aluno vinculado', '')];
  for (const aluno of alunos) {
    if (!aluno.ativo && aluno.id !== selecionado) continue;
    const opcao = new Option(aluno.nome + (aluno.ativo ? '' : ' (inativo)'), aluno.id);
    opcao.disabled = !aluno.ativo;
    opcoes.push(opcao);
  }
  if (selecionado && !alunos.some(a => a.id === selecionado)) {
    const ausente = new Option('Aluno indisponível — escolha outra opção', selecionado);
    ausente.disabled = true; opcoes.push(ausente);
  }
  $('vinculo-aluno').replaceChildren(...opcoes);
  $('vinculo-aluno').value = selecionado;
  $('salvar-vinculo').disabled = salvandoVinculo || !alunosCarregados || !comunicadoresCarregados;
}

function limparFormularioVinculo(focar = true) {
  vinculoBase = null;
  $('formulario-vinculo').reset();
  $('vinculo-dispositivo').setCustomValidity('');
  $('erro-vinculo').hidden = true;
  $('erro-vinculo').textContent = '';
  $('resultado-vinculo').textContent = '';
  if (focar) $('vinculo-dispositivo').focus();
}

function identificarVinculo() {
  const nome = $('vinculo-dispositivo').value.trim();
  $('vinculo-dispositivo').setCustomValidity(nome ? '' : 'Informe a identificação do comunicador.');
  if (vinculoBase && vinculoBase.dispositivo === nome) return;
  const atual = comunicadores.find(c => c.dispositivo === nome);
  vinculoBase = {dispositivo:nome, versao:atual ? atual.versao : 0, aluno_id:atual ? atual.aluno_id : null};
  // Recria as opções antes de selecionar um aluno que pode estar inativo.
  if (atual && atual.aluno_id) {
    const opcao = new Option(atual.aluno_nome, atual.aluno_id);
    $('vinculo-aluno').append(opcao);
  }
  $('vinculo-aluno').value = atual && atual.aluno_id ? atual.aluno_id : '';
  renderizarOpcoesVinculo();
  $('resultado-vinculo').textContent = atual && atual.aluno_id && !atual.aluno_ativo ? 'O aluno vinculado está inativo. Escolha um aluno ativo ou remova o vínculo.' : '';
  $('erro-vinculo').hidden = true;
}

function renderizarComunicadores() {
  const fragmento = document.createDocumentFragment();
  for (const comunicador of comunicadores) {
    const linha = elemento('li', 'registro-comunicador-vinculo');
    const dados = elemento('div', 'aluno-dados');
    dados.append(elemento('h2', '', comunicador.dispositivo));
    dados.append(elemento('p', '', comunicador.aluno_id ? 'Aluno: ' + comunicador.aluno_nome + (comunicador.aluno_ativo ? '' : ' (inativo)') : 'Sem aluno vinculado'));
    const editar = elemento('button', 'botao-texto', 'Alterar vínculo');
    editar.type = 'button'; editar.setAttribute('aria-label', 'Alterar vínculo: ' + comunicador.dispositivo);
    editar.addEventListener('click', () => {
      if (salvandoVinculo) return;
      vinculoBase = null;
      $('vinculo-dispositivo').value = comunicador.dispositivo;
      identificarVinculo();
      $('vinculo-aluno').focus();
    });
    linha.append(dados, editar); fragmento.append(linha);
  }
  $('lista-comunicadores').replaceChildren(fragmento);
  $('opcoes-comunicadores').replaceChildren(...comunicadores.map(c => new Option(c.dispositivo, c.dispositivo)));
  $('quantidade-comunicadores').textContent = comunicadores.length + (comunicadores.length === 1 ? ' comunicador' : ' comunicadores');
  $('vazio-comunicadores').hidden = comunicadores.length !== 0;
  renderizarOpcoesVinculo();
}

async function atualizarComunicadores() {
  if (!conectado) return;
  if (consultaComunicadores) return consultaComunicadores;
  const atual = sessao;
  $('lista-comunicadores').setAttribute('aria-busy', 'true');
  $('atualizar-comunicadores').disabled = true;
  $('erro-comunicadores').hidden = true;
  if (!comunicadoresCarregados) {
    $('quantidade-comunicadores').textContent = 'Carregando comunicadores…';
    $('vazio-comunicadores').hidden = true;
  }
  consultaComunicadores = (async () => {
    try {
      const lista = await api('/api/comunicadores');
      if (atual !== sessao || !conectado) return;
      comunicadores = lista; comunicadoresCarregados = true;
      renderizarComunicadores();
    } catch (erro) {
      if (atual !== sessao || !conectado) return;
      if (erro.status === 401) tratarErroCadastro(erro);
      else {
        $('erro-comunicadores').textContent = erro.message + (comunicadoresCarregados ? ' A lista anterior continua visível.' : ' Use Atualizar comunicadores para tentar novamente.');
        $('erro-comunicadores').hidden = false;
        if (!comunicadoresCarregados) $('quantidade-comunicadores').textContent = 'Lista indisponível';
      }
    } finally {
      if (atual === sessao) {
        $('lista-comunicadores').setAttribute('aria-busy', 'false');
        $('atualizar-comunicadores').disabled = false;
      }
    }
  })();
  const operacao = consultaComunicadores;
  await operacao;
  if (consultaComunicadores === operacao) consultaComunicadores = null;
}

async function salvarVinculo(evento) {
  evento.preventDefault();
  if (!conectado || salvandoVinculo || !alunosCarregados || !comunicadoresCarregados) return;
  const dispositivo = $('vinculo-dispositivo').value.trim();
  $('vinculo-dispositivo').setCustomValidity(dispositivo ? '' : 'Informe a identificação do comunicador.');
  if (!$('formulario-vinculo').reportValidity()) return;
  if (!vinculoBase || vinculoBase.dispositivo !== dispositivo) identificarVinculo();
  const alunoId = $('vinculo-aluno').value || null;
  if (vinculoBase.aluno_id && vinculoBase.aluno_id !== alunoId && !window.confirm(alunoId ? 'Trocar o aluno vinculado ao comunicador ' + dispositivo + '?' : 'Remover o vínculo do comunicador ' + dispositivo + '?')) return;
  const dados = {dispositivo, aluno_id:alunoId, versao:vinculoBase.versao};
  const atual = sessao;
  salvandoVinculo = true;
  $('campos-vinculo').disabled = true;
  $('salvar-vinculo').textContent = 'Salvando…';
  $('erro-vinculo').hidden = true;
  $('resultado-vinculo').textContent = '';
  try {
    await api('/api/comunicadores/vincular', dados);
    if (atual !== sessao || !conectado) return;
    limparFormularioVinculo(false);
    if (consultaComunicadores) await consultaComunicadores;
    if (atual !== sessao || !conectado) return;
    await atualizarComunicadores();
    if (atual !== sessao || !conectado) return;
    $('resultado-vinculo').textContent = alunoId ? 'Vínculo salvo.' : 'Comunicador salvo sem aluno vinculado.';
    $('quantidade-comunicadores').setAttribute('tabindex', '-1');
    $('quantidade-comunicadores').focus({preventScroll:true});
  } catch (erro) {
    if (atual !== sessao || !conectado) return;
    if (erro.status === 401) tratarErroCadastro(erro);
    else { $('erro-vinculo').textContent = erro.message; $('erro-vinculo').hidden = false; }
  } finally {
    if (atual === sessao) {
      salvandoVinculo = false;
      $('campos-vinculo').disabled = false;
      $('salvar-vinculo').textContent = 'Salvar vínculo';
      renderizarOpcoesVinculo();
    }
  }
}

function tratarErroCadastro(erro) {
  if (erro.status === 401) {
    limparSessao(false);
    $('erro').textContent = 'Sua sessão terminou. Entre novamente.';
    $('senha').focus();
  } else {
    $('erro-formulario-aluno').textContent = erro.message;
    $('erro-formulario-aluno').hidden = false;
  }
}

function lerFotoSelecionada(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).split(',')[1]);
    leitor.onerror = () => reject(new FalhaAPI('Não foi possível ler a foto. Selecione outra imagem.'));
    leitor.onabort = () => reject(new FalhaAPI('Leitura da foto cancelada.'));
    leitor.readAsDataURL(arquivo);
  });
}

async function salvarCadastroAluno(evento) {
  evento.preventDefault();
  if (!conectado || salvandoAluno) return;
  atualizarPreviaAluno();
  if (!$('formulario-aluno').reportValidity()) return;
  const atual = sessao, geracao = geracaoFormulario;
  const dados = {id: alunoEdicao ? alunoEdicao.id : novoAlunoId, nome: $('aluno-nome').value.trim(),
    perfil_acessibilidade: $('aluno-perfil').value, autorizado: $('aluno-autorizado').checked};
  const editando = Boolean(alunoEdicao);
  if (editando) dados.versao = alunoEdicao.versao;
  const arquivo = $('aluno-foto').files[0];
  if (removerFoto) dados.foto = null;
  salvandoAluno = true;
  $('campos-cadastro-aluno').disabled = true;
  $('salvar-aluno').textContent = 'Salvando…';
  $('erro-formulario-aluno').hidden = true;
  let salvo = false;
  try {
    if (arquivo && !removerFoto) dados.foto = await lerFotoSelecionada(arquivo);
    if (atual !== sessao || geracao !== geracaoFormulario || !conectado) return;
    await api(editando ? '/api/alunos/editar' : '/api/alunos', dados);
    if (atual !== sessao || geracao !== geracaoFormulario || !conectado) return;
    salvo = true;
    fecharFormularioAluno();
    if (consultaAlunos) await consultaAlunos;
    if (atual !== sessao || !conectado) return;
    await atualizarAlunos();
    if (atual === sessao && conectado) avisar(editando ? 'Cadastro atualizado.' : 'Aluno cadastrado.');
  } catch (erro) {
    if (atual === sessao && geracao === geracaoFormulario && conectado) tratarErroCadastro(erro);
  } finally {
    if (!salvo && atual === sessao && geracao === geracaoFormulario) {
      salvandoAluno = false;
      $('campos-cadastro-aluno').disabled = false;
      $('salvar-aluno').textContent = editando ? 'Salvar alterações' : 'Salvar cadastro';
    }
  }
}

async function executarAcaoAluno(rota, dados, botao, mensagem) {
  const atual = sessao;
  botao.disabled = true;
  try {
    await api(rota, dados);
    if (atual !== sessao || !conectado) return;
    if (alunoEdicao && alunoEdicao.id === dados.id) fecharFormularioAluno(false);
    if (consultaAlunos) await consultaAlunos;
    if (atual !== sessao || !conectado) return;
    await atualizarAlunos();
    if (atual === sessao && conectado) {
      avisar(mensagem);
      $('quantidade-alunos').setAttribute('tabindex', '-1');
      $('quantidade-alunos').focus({preventScroll:true});
    }
  } catch (erro) {
    if (atual !== sessao || !conectado) return;
    if (erro.status === 401) tratarErroCadastro(erro);
    else { avisar(erro.message); if (erro.status === 409 || erro.status === 404) await atualizarAlunos(); }
  } finally { if (botao.isConnected) botao.disabled = false; }
}

function mudarSituacaoAluno(aluno, botao) {
  const acao = aluno.ativo ? 'Desativar' : 'Reativar';
  if (!window.confirm(acao + ' o cadastro de ' + aluno.nome + '?' + (aluno.ativo ? ' Os dados e a foto serão mantidos para consulta.' : ''))) return;
  return executarAcaoAluno('/api/alunos/situacao', {id:aluno.id,versao:aluno.versao,ativo:!aluno.ativo,confirmado:true}, botao, 'Situação do aluno atualizada.');
}

function excluirAluno(aluno, botao) {
  const confirmacao = window.prompt('Excluir definitivamente o cadastro e a foto de ' + aluno.nome + '? Esta ação não pode ser desfeita. Para confirmar, digite o nome do aluno:');
  if (confirmacao === null) return;
  if (confirmacao !== aluno.nome) { avisar('Nome diferente. Nenhum cadastro foi excluído.'); return; }
  return executarAcaoAluno('/api/alunos/excluir', {id:aluno.id,versao:aluno.versao,confirmacao}, botao, 'Cadastro e foto excluídos.');
}

function aplicarPedidos(lista) {
  const novos = primeiraCarga ? [] : lista.filter(p => !vistos.has(p.id) && p.estado === 'novo');
  pedidos = lista;
  vistos = new Set(lista.map(p => p.id));
  primeiraCarga = false;
  conexao(true);
  renderizar();
  if (novos.length) {
    $('anuncio').textContent = novos.length === 1 ? 'Novo pedido de ' + nomeAlunoPedido(novos[0]) + ', ' + novos[0].dispositivo + ': ' + novos[0].frase : novos.length + ' novos pedidos recebidos.';
    if (somAtivo) tocar();
  }
}

async function atualizar() {
  if (!conectado) return;
  if (consulta) return consulta;
  if (Date.now() - ultimaConsultaAlunos > 15000 && !consultaAlunos) atualizarAlunos();
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
  alunos = []; alunosCarregados = false; consultaAlunos = null; ultimaConsultaAlunos = 0;
  $('total-alunos').textContent = '—';
  comunicadores = []; consultaComunicadores = null; comunicadoresCarregados = false; salvandoVinculo = false;
  limparFormularioVinculo(false);
  $('campos-vinculo').disabled = false; $('salvar-vinculo').textContent = 'Salvar vínculo';
  $('lista-comunicadores').replaceChildren(); $('opcoes-comunicadores').replaceChildren();
  $('lista-comunicadores').setAttribute('aria-busy', 'false');
  $('quantidade-comunicadores').textContent = ''; $('erro-comunicadores').textContent = '';
  $('erro-comunicadores').hidden = true; $('vazio-comunicadores').hidden = true;
  $('atualizar-comunicadores').disabled = false; renderizarOpcoesVinculo();
  fecharFormularioAluno(false);
  $('lista-alunos').replaceChildren();
  $('lista-alunos').setAttribute('aria-busy', 'false');
  $('quantidade-alunos').textContent = '';
  $('erro-alunos').textContent = ''; $('erro-alunos').hidden = true;
  $('vazio-alunos').hidden = true; $('atualizar-alunos').disabled = false;
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
  $('filtro-aluno').replaceChildren(new Option('Todos os alunos',''), new Option('Sem aluno identificado','__sem_aluno__'));
  $('filtro-aluno').value = '';
  $('busca').value = ''; mudarVisao('pendentes', false);
  if (focar) $('instituicao').focus();
}

function mudarVisao(nova, desenhar = true) {
  visao = nova; assinatura = '';
  for (const id of ['pendentes','historico','alunos','comunicadores']) {
    $('nav-' + id).classList.toggle('selecionado', id === nova);
    if (id === nova) $('nav-' + id).setAttribute('aria-current','page');
    else $('nav-' + id).removeAttribute('aria-current');
  }
  const alunosVisiveis = nova === 'alunos';
  const comunicadoresVisiveis = nova === 'comunicadores';
  $('painel-comunicadores').hidden = !comunicadoresVisiveis;
  $('painel-pedidos').hidden = alunosVisiveis || comunicadoresVisiveis;
  $('painel-alunos').hidden = !alunosVisiveis;
  $('rodape-pedidos').hidden = alunosVisiveis || comunicadoresVisiveis;
  $('pular').textContent = 'Pular para o conteúdo';
  $('resumo-pedidos').hidden = nova !== 'pendentes';
  if (comunicadoresVisiveis) {
    $('titulo-pagina').textContent = 'Comunicadores';
    $('descricao-pagina').textContent = 'Associe cada aparelho ao aluno que o utiliza.';
    $('aviso-novos').hidden = true;
    if (desenhar) { atualizarAlunos(); atualizarComunicadores(); }
    return;
  }
  if (alunosVisiveis) {
    $('titulo-pagina').textContent = 'Alunos';
    $('descricao-pagina').textContent = 'Consulte os alunos cadastrados e seus perfis de acessibilidade.';
    $('aviso-novos').hidden = true;
    if (desenhar) atualizarAlunos();
    return;
  }
  $('titulo-pagina').textContent = nova === 'pendentes' ? 'Pedidos pendentes' : 'Histórico de chamados';
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
  atualizarAlunos();
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
$('nav-alunos').addEventListener('click', () => mudarVisao('alunos'));
$('nav-comunicadores').addEventListener('click', () => mudarVisao('comunicadores'));
$('atualizar-comunicadores').addEventListener('click', () => { atualizarAlunos(); atualizarComunicadores(); });
$('vinculo-dispositivo').addEventListener('input', identificarVinculo);
$('formulario-vinculo').addEventListener('submit', salvarVinculo);
$('limpar-vinculo').addEventListener('click', () => limparFormularioVinculo());
$('atualizar-alunos').addEventListener('click', atualizarAlunos);
$('novo-aluno').addEventListener('click', () => abrirFormularioAluno());
$('cancelar-aluno').addEventListener('click', () => fecharFormularioAluno());
$('aluno-nome').addEventListener('input', atualizarPreviaAluno);
$('aluno-perfil').addEventListener('change', atualizarPreviaAluno);
$('aluno-foto').addEventListener('change', selecionarFotoAluno);
$('remover-foto-aluno').addEventListener('click', () => { limparFotoAluno(); $('aluno-foto').focus(); });
$('previa-aluno-foto').addEventListener('error', () => {
  if (!fotoAlunoURL) return;
  limparFotoAluno();
  $('erro-aluno-foto').textContent = 'Não foi possível abrir esta imagem. Selecione outra foto.';
  $('erro-aluno-foto').hidden = false;
  $('aluno-foto').setAttribute('aria-invalid', 'true');
  $('aluno-foto').setCustomValidity('Selecione outra foto ou remova a seleção.');
  $('remover-foto-aluno').hidden = false;
});
$('formulario-aluno').addEventListener('submit', salvarCadastroAluno);

for (const id of ['filtro-aluno','dispositivo','filtro-estado']) $(id).addEventListener('change', () => renderizar(true));
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
