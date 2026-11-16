// Ensaio do modo aluno em banco temporário; não altera a instalação real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const {spawn,spawnSync} = require('node:child_process');
const {chromium,request} = require('playwright');
const raiz=path.join(__dirname,'..'), python=process.env.PYTHON_TEST || 'python';
const temporario=fs.mkdtempSync(path.join(os.tmpdir(),'modo-aluno-'));
let servidor,navegador,admin;
const pausa=ms=>new Promise(r=>setTimeout(r,ms));
async function esperarCondicao(page,condicao){
  const limite=Date.now()+20000;
  while(Date.now()<limite){if(await page.evaluate(condicao))return;await pausa(100);}
  throw new Error('Condição assíncrona da fila não foi satisfeita.');
}
async function capturar(page,opcoes){
  for(let tentativa=0;;tentativa++){
    try{return await page.screenshot(opcoes);}
    catch(erro){if(tentativa>=2 || !erro.message.includes('Unable to capture screenshot'))throw erro;await pausa(250);}
  }
}
(async()=>{
  const porta=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const url='http://127.0.0.1:'+porta;
  servidor=spawn(python,['-B','servidor.py','--demo','--porta',String(porta),'--dados',path.join(temporario,'dados')],{cwd:raiz,stdio:'ignore',windowsHide:true});
  let pronto=false;
  for(let i=0;i<80;i++){pronto=await new Promise(resolve=>{const req=http.get(url,res=>{res.resume();res.on('end',()=>resolve(res.statusCode===200));});req.on('error',()=>resolve(false));req.setTimeout(1500,()=>{req.destroy();resolve(false);});});if(pronto)break;await pausa(200);}
  assert(pronto,'Servidor não iniciou');
  admin=await request.newContext({baseURL:url,extraHTTPHeaders:{'X-Portal':'tutora'}});
  async function post(rota,dados){const r=await admin.post(rota,{data:dados});assert(r.ok(),await r.text());return r.json();}
  await post('/api/login',{instituicao:'164275',usuario:'testedev',senha:'123456'});
  const fixture=path.join(temporario,'foto.png');
  const foto=spawnSync(python,['-c',"from PIL import Image; import sys; Image.new('RGB',(100,100),'teal').save(sys.argv[1])",fixture],{windowsHide:true});
  assert.equal(foto.status,0);
  const ana=await post('/api/alunos',{nome:'Ana fictícia',perfil_acessibilidade:'padrao',foto:fs.readFileSync(fixture).toString('base64'),autorizado:true});
  const bruno=await post('/api/alunos',{nome:'Bruno fictício',autorizado:true});
  await post('/api/comunicadores/vincular',{dispositivo:'Tablet 01',aluno_id:ana.id,versao:0});
  navegador=await chromium.launch({headless:true,args:['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],...(process.env.TEST_BROWSER?{channel:process.env.TEST_BROWSER}:{})});
  const contexto=await navegador.newContext({viewport:{width:1024,height:768}});
  let page=await contexto.newPage();page.setDefaultTimeout(20000);
  const erros=[];
  function observar(p){p.on('pageerror',e=>erros.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/Content Security Policy/i.test(m.text()))erros.push(m.text());});}
  observar(page);
  await page.goto(url+'/aluno');
  await page.locator('#acesso-entrada').waitFor({state:'visible'});
  assert.equal(await page.locator('#blocos-alunos button').count(),0);
  await page.goto(url);
  await page.locator('#instituicao').fill('164275');await page.locator('#usuario').fill('testedev');await page.locator('#senha').fill('123456');await page.locator('#senha').press('Enter');
  await page.locator('#portal').waitFor({state:'visible'});
  // Acesso destacado dentro do portal da tutora, sem escolha de modo no login.
  assert.equal(await page.locator('#abrir-modo-aluno').count(),1);
  assert.equal((await page.locator('#abrir-modo-aluno').innerText()).replace(/\s+/g,' '),'Portal do aluno ↗');
  fs.mkdirSync(path.join(raiz,'tmp'),{recursive:true});
  for(const [nome,width,height] of [['pc',1366,900],['tablet',1024,768],['celular',390,844]]){
    await page.setViewportSize({width,height});
    const posicao=await page.locator('#abrir-modo-aluno').evaluate(botao=>{
      const b=botao.getBoundingClientRect(),h=botao.closest('header').getBoundingClientRect();
      return {direita:h.right-b.right,topo:b.top-h.top,altura:b.height};
    });
    assert(Math.abs(posicao.direita)<2&&Math.abs(posicao.topo)<2&&posicao.altura>=48);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await capturar(page,{path:path.join(raiz,'tmp','acesso-portal-aluno-'+nome+'.png'),fullPage:true});
  }
  await page.setViewportSize({width:1024,height:768});
  for(const [perfil,nome] of [['tea','Carla fictícia'],['motora','Daniel fictício'],['intelectual','Elisa fictícia'],['baixa_visao','Fábio fictício']])await post('/api/alunos',{nome,perfil_acessibilidade:perfil,autorizado:true});
  await page.locator('#abrir-modo-aluno').click();
  await page.locator('#escolha-aluno').waitFor({state:'visible'});await page.waitForFunction(()=>!ocupado);
  await page.waitForFunction(()=>document.querySelectorAll('#blocos-alunos button').length===6);
  assert.equal(await page.locator('#escolha-aluno input').count(),0);
  assert.equal(await page.locator('#configuracao').count(),0);
  assert.equal((await contexto.request.get(url+'/api/sessao')).status(),401);
  assert.equal((await admin.get('/api/sessao')).status(),200);
  for(const cor of ['azul','roxo','ambar','verde','neutro'])assert.equal(await page.locator('.tag-aluno.cor-'+cor).count(),cor==='neutro'?2:1);
  fs.mkdirSync(path.join(raiz,'tmp'),{recursive:true});
  for(const [nome,width,height] of [['tablet',1024,768],['celular',390,844],['pc',1366,900],['estreito',320,700]]){
    await page.setViewportSize({width,height});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),nome+' com rolagem horizontal');
    await capturar(page,{path:path.join(raiz,'tmp','entrada-alunos-'+nome+'.png'),fullPage:true});
  }
  // O aluno entra pelo próprio bloco, sem identificação digitada.
  await page.locator('[data-aluno="'+ana.id+'"]').click();
  await page.locator('#identidade').waitFor({state:'visible'});
  assert.equal(await page.locator('#nome-aluno').innerText(),'Ana fictícia');
  await page.waitForFunction(()=>document.getElementById('foto').complete&&document.getElementById('foto').naturalWidth>0);
  assert.equal((await contexto.request.get(url+'/api/alunos')).status(),401);
  const cookie=(await contexto.cookies(url+'/api/aluno/entrada')).find(c=>c.name==='entrada_sessao');
  assert(cookie.httpOnly);assert.equal(cookie.sameSite,'Strict');
  await page.setViewportSize({width:1024,height:768});
  // Categorias, todas as opções e navegação por teclado, sem enviar chamados.
  const envios=[];
  page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/pedidos'))envios.push(r.url());});
  const catalogo=await (await contexto.request.get(url+'/api/aluno/catalogo')).json();
  assert.equal(await page.locator('#opcoes-comunicacao button').count(),4);
  await page.locator('[data-mensagem="ajuda"]').click();
  assert.equal(await page.locator('#texto-mensagem').innerText(),'Preciso de ajuda.');
  assert.equal(await page.locator('[data-mensagem="ajuda"]').getAttribute('aria-pressed'),'true');
  assert(await page.locator('#selecao-mensagem').isVisible());
  assert(await page.locator('#confirmar-mensagem').isEnabled());
  await page.keyboard.press('Escape');
  assert(await page.locator('[data-mensagem="ajuda"]').evaluate(n=>n===document.activeElement));
  for(const categoria of catalogo.categorias){
    await page.locator('[data-categoria="'+categoria.id+'"]').click();
    assert.equal(await page.locator('#titulo-comunicacao').innerText(),categoria.rotulo);
    assert.equal(await page.locator('#opcoes-comunicacao button').count(),categoria.mensagens.length);
    for(const mensagem of categoria.mensagens){
      const botao=page.locator('[data-mensagem="'+mensagem.id+'"]');
      await botao.click();
      assert.equal(await page.locator('#texto-mensagem').innerText(),mensagem.frase);
      assert.equal(await botao.getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('#opcoes-comunicacao [aria-pressed="true"]').count(),1);
      assert(await page.locator('#titulo-confirmacao').evaluate(n=>n===document.activeElement));
      assert(await page.locator('#confirmar-mensagem').isEnabled());
      await page.locator('#voltar-mensagem').click();
      assert(await page.locator('#selecao-mensagem').isHidden());
      assert(await botao.evaluate(n=>n===document.activeElement));
    }
    for(const [nome,width,height] of [['tablet',1024,768],['celular',390,844],['pc',1366,900]]){
      await page.setViewportSize({width,height});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),categoria.id+' / '+nome+' com rolagem horizontal');
      const tamanhos=await page.locator('#opcoes-comunicacao button').evaluateAll(bs=>bs.map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height})));
      assert(tamanhos.every(t=>t.w>=100&&t.h>=150));
      await page.locator('#opcoes-comunicacao button').first().click();
      assert(await page.evaluate(()=>{const d=document.getElementById('selecao-mensagem');return d.scrollWidth<=d.clientWidth;}));
      await page.waitForFunction(()=>document.querySelector('#desenho-confirmacao use').getBBox().width>0);
      await capturar(page,{path:path.join(raiz,'tmp','confirmacao-'+categoria.id+'-'+nome+'.png'),fullPage:true});
      await page.locator('#voltar-mensagem').click();
    }
    await page.locator('#inicio-comunicacao').click();
    assert(await page.locator('#selecao-mensagem').isHidden());
  }
  await page.locator('[data-categoria="necessidades"]').focus();await page.keyboard.press('Enter');
  assert(await page.locator('#titulo-comunicacao').evaluate(n=>n===document.activeElement));
  await page.keyboard.press('Tab');await page.keyboard.press('Space');
  assert.equal(await page.locator('#texto-mensagem').innerText(),'Quero água.');
  // Uma atualização do mesmo aluno preserva categoria, seleção e foco.
  await post('/api/alunos/editar',{id:ana.id,versao:1,nome:'Ana fictícia revisada',autorizado:true});
  const foco=await page.locator('#titulo-confirmacao').evaluate(n=>n===document.activeElement);
  assert(foco);
  await page.evaluate(()=>atualizar());
  assert.equal(await page.locator('#nome-aluno').innerText(),'Ana fictícia revisada');
  assert.equal(await page.locator('#titulo-comunicacao').innerText(),'Necessidades');
  assert.equal(await page.locator('#texto-mensagem').innerText(),'Quero água.');
  assert(await page.locator('#titulo-confirmacao').evaluate(n=>n===document.activeElement));
  await page.keyboard.press('Tab');
  assert(await page.locator('#voltar-mensagem').evaluate(n=>n===document.activeElement));
  await page.keyboard.press('Tab');
  assert(await page.locator('#confirmar-mensagem').evaluate(n=>n===document.activeElement));
  await page.keyboard.press('Tab');
  // O diálogo nativo pode passar pelo foco da janela ao completar o ciclo.
  assert(await page.evaluate(()=>document.activeElement===document.body || document.getElementById('selecao-mensagem').contains(document.activeElement)));
  await page.keyboard.press('Escape');
  assert(await page.locator('[data-mensagem="agua"]').evaluate(n=>n===document.activeElement));
  assert.deepEqual(envios,[]);
  assert.equal((await (await admin.get('/api/pedidos')).json()).length,0);
  // Uma confirmação gera um chamado mesmo com cliques repetidos.
  await post('/api/tutores',{nome:'Tutora fictícia',usuario:'lili',senha:'123',alunos:[ana.id]});
  await page.locator('[data-mensagem="agua"]').click();
  await page.evaluate(()=>{const b=document.getElementById('confirmar-mensagem');b.click();b.click();b.click();});
  await page.waitForFunction(()=>document.getElementById('resultado-envio').textContent==='Mensagem enviada à tutora.' && !enviando);
  let pedidos=await (await admin.get('/api/pedidos')).json();
  assert.equal(pedidos.length,1);assert.equal(pedidos[0].aluno_id,ana.id);
  assert.equal(pedidos[0].frase,'Quero água.');assert.equal(pedidos[0].encaminhamento,'responsavel');
  // O servidor salva, mas a resposta se perde. A fila conserva o ID.
  await page.locator('[data-mensagem="agua"]').click();
  let tentativas=[];
  await page.route('**/api/aluno/enviar',async rota=>{
    tentativas.push(rota.request().postDataJSON());
    if(tentativas.length===1){const resposta=await rota.fetch();assert(resposta.ok());await rota.abort();}
    else await rota.continue();
  });
  await page.locator('#confirmar-mensagem').click();
  await esperarCondicao(page,async()=>{const n=(await FilaAluno.listar()).length;return !enviando && n===1 && !document.getElementById('selecao-mensagem').open && proximaTentativa>Date.now();});
  assert(await page.locator('#selecao-mensagem').isHidden());
  await page.locator('#reenviar-fila').click();
  await esperarCondicao(page,async()=>{const n=(await FilaAluno.listar()).length;return !enviando && n===0;});
  assert.equal(tentativas.length,2,'tentativas após resposta perdida');assert.equal(tentativas[0].id,tentativas[1].id);
  assert.equal((await (await admin.get('/api/pedidos')).json()).length,2,'chamados após resposta perdida');
  pedidos=await (await admin.get('/api/pedidos')).json();assert.equal(pedidos.length,2);
  await page.unroute('**/api/aluno/enviar');

  // Sem rede: confirma duas mensagens e persiste antes de qualquer POST.
  await contexto.setOffline(true);
  for(const id of ['agua','comida']){
    await page.locator('[data-mensagem="'+id+'"]').click();
    await page.locator('#confirmar-mensagem').click();
    await page.waitForFunction(()=>!enviando && !document.getElementById('selecao-mensagem').open);
  }
  const filaAntes=await page.evaluate(()=>FilaAluno.listar());
  assert.equal(filaAntes.length,2);
  assert(filaAntes.every(p=>p.aluno_id===ana.id));
  assert.deepEqual(Object.keys(filaAntes[0]).sort(),['aluno_id','criado','id','mensagem']);
  assert.equal((await (await admin.get('/api/pedidos')).json()).length,2);
  await capturar(page,{path:path.join(raiz,'tmp','fila-offline-tablet.png'),fullPage:true});
  // Reconecta com envio ainda indisponível: recarregar mantém a fila e pede escolha.
  let bloquear=true;
  await page.route('**/api/aluno/enviar',r=>bloquear?r.abort():r.continue());
  await contexto.setOffline(false);
  await page.waitForFunction(()=>!enviando && !ocupado);
  await page.close();page=await contexto.newPage();page.setDefaultTimeout(20000);observar(page);
  await page.route('**/api/aluno/enviar',r=>bloquear?r.abort():r.continue());
  await page.goto(url+'/aluno');await page.locator('#escolha-aluno').waitFor({state:'visible'});await page.waitForFunction(()=>!ocupado);
  assert.equal((await page.evaluate(()=>FilaAluno.listar())).length,2);
  // Outro aluno não envia os pedidos anteriores.
  await page.locator('[data-aluno="'+bruno.id+'"]').click();await page.locator('#identidade').waitFor({state:'visible'});
  await page.evaluate(()=>sincronizarFila(true));
  assert.equal((await (await admin.get('/api/pedidos')).json()).length,2);
  assert.equal((await page.evaluate(()=>FilaAluno.listar())).length,2);
  await page.locator('#trocar-aluno').click();await page.locator('#escolha-aluno').waitFor({state:'visible'});await page.waitForFunction(()=>!ocupado);
  bloquear=false;
  await page.locator('[data-aluno="'+ana.id+'"]').click();await page.locator('#identidade').waitFor({state:'visible'});
  await esperarCondicao(page,async()=>{const n=(await FilaAluno.listar()).length;return !enviando && !ocupado && n===0;});
  pedidos=await (await admin.get('/api/pedidos')).json();assert.equal(pedidos.length,4);
  assert(pedidos.every(p=>p.aluno_id===ana.id));
  assert.equal(pedidos.filter(p=>p.frase==='Estou com fome.').length,1);

  // Fila indisponível não vira mensagem enviada, nem tenta o POST.
  await page.evaluate(()=>{window.salvarFilaOriginal=FilaAluno.salvar;FilaAluno.salvar=async()=>{throw new Error('armazenamento cheio');};});
  await page.locator('[data-categoria="necessidades"]').click();
  await page.locator('[data-mensagem="agua"]').click();await page.locator('#confirmar-mensagem').click();
  await page.waitForFunction(()=>document.getElementById('aviso-confirmacao').textContent.includes('Nada foi enviado'));
  assert.equal((await (await admin.get('/api/pedidos')).json()).length,4);
  await page.evaluate(()=>{FilaAluno.salvar=window.salvarFilaOriginal;delete window.salvarFilaOriginal;});
  await page.keyboard.press('Escape');

  // Descarte exige confirmação; cancelar preserva os pendentes.
  bloquear=true;
  await page.locator('[data-mensagem="agua"]').click();await page.locator('#confirmar-mensagem').click();
  await esperarCondicao(page,async()=>{const n=(await FilaAluno.listar()).length;return !enviando && n===1 && !document.getElementById('selecao-mensagem').open && proximaTentativa>Date.now();});
  page.once('dialog',d=>d.dismiss());await page.locator('#limpar-fila').click();
  assert.equal((await page.evaluate(()=>FilaAluno.listar())).length,1);
  page.once('dialog',d=>d.accept());await page.locator('#limpar-fila').click();
  await esperarCondicao(page,async()=>{const n=(await FilaAluno.listar()).length;return !enviando && n===0;});
  assert.equal((await (await admin.get('/api/pedidos')).json()).length,4);
  await page.unroute('**/api/aluno/enviar');
  assert.equal(await page.locator('audio').count(),0);

  await page.reload();await page.locator('#escolha-aluno').waitFor({state:'visible'});await page.waitForFunction(()=>!ocupado);
  await page.locator('[data-aluno="'+ana.id+'"]').click();await page.locator('#identidade').waitFor({state:'visible'});
  assert.equal(await page.locator('#nome-aluno').innerText(),'Ana fictícia revisada');
  await page.locator('#trocar-aluno').click();
  await page.locator('#escolha-aluno').waitFor({state:'visible'});await page.waitForFunction(()=>!ocupado);
  await page.locator('[data-aluno="'+bruno.id+'"]').focus();await page.keyboard.press('Enter');
  await page.locator('#identidade').waitFor({state:'visible'});
  assert.equal(await page.locator('#nome-aluno').innerText(),'Bruno fictício');
  assert.equal(await page.locator('#titulo-comunicacao').innerText(),'O que você quer comunicar?');
  assert.equal(await page.locator('#texto-mensagem').innerText(),'');
  assert(await page.locator('#selecao-mensagem').isHidden());
  assert(await page.locator('#foto').isHidden());
  assert.equal(await page.locator('#foto').getAttribute('src'),null);
  await page.locator('[data-mensagem="ajuda"]').click();
  await post('/api/alunos/situacao',{id:bruno.id,versao:1,ativo:false,confirmado:true});
  // Cadastro desativado entre a escolha e o envio: o servidor recusa, a fila fica bloqueada.
  await page.locator('#confirmar-mensagem').click();
  await esperarCondicao(page,async()=>{const fila=await FilaAluno.listar();return !enviando && fila.length===1 && fila[0].bloqueado===true;});
  assert.equal((await (await admin.get('/api/pedidos')).json()).length,4);
  await page.evaluate(()=>atualizar());await page.locator('#vinculo-pendente').waitFor({state:'visible'});
  assert.equal(await page.locator('#titulo-pendente').innerText(),'Cadastro inativo');
  page.once('dialog',d=>d.accept());await page.locator('#limpar-fila').click();
  await esperarCondicao(page,async()=>{const fila=await FilaAluno.listar();return !enviando && fila.length===0;});
  assert(await page.locator('#selecao-mensagem').isHidden());
  assert.equal(await page.locator('#nome-aluno').innerText(),'');
  await page.locator('#trocar-aluno').click();
  await page.locator('#escolha-aluno').waitFor({state:'visible'});await page.waitForFunction(()=>!ocupado);
  assert.equal(await page.locator('[data-aluno="'+bruno.id+'"]').count(),0);
  await page.locator('[data-aluno="'+ana.id+'"]').click();
  await page.locator('#identidade').waitFor({state:'visible'});
  await page.locator('[data-mensagem="ajuda"]').click();
  await page.route('**/api/aluno/perfil',r=>r.abort());
  await page.evaluate(()=>atualizar());
  assert(await page.locator('#falha-conexao').isVisible());
  assert(await page.locator('#selecao-mensagem').isVisible());
  assert.equal(await page.locator('#nome-aluno').innerText(),'Ana fictícia revisada');
  await page.keyboard.press('Escape');
  await page.unroute('**/api/aluno/perfil');await page.locator('#atualizar').click();
  await page.locator('#identidade').waitFor({state:'visible'});
  await page.locator('#trocar-aluno').click();
  await page.locator('#escolha-aluno').waitFor({state:'visible'});await page.waitForFunction(()=>!ocupado);
  assert.equal((await contexto.request.get(url+'/api/aluno/perfil')).status(),401);
  assert.equal(await page.locator('#nome-aluno').innerText(),'');
  await page.locator('[data-aluno="'+ana.id+'"]').click();await page.locator('#identidade').waitFor({state:'visible'});
  // Expiração da autorização da grade remove nomes e fotos, sem tornar a lista pública.
  const expirar=spawnSync(python,['-c',"import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('UPDATE sessoes_entrada SET expira=0'); c.commit(); c.close()",path.join(temporario,'dados','pedidos.sqlite3')],{windowsHide:true});
  assert.equal(expirar.status,0);
  await page.locator('#trocar-aluno').click();await page.locator('#acesso-entrada').waitFor({state:'visible'});
  assert.equal(await page.locator('#blocos-alunos button').count(),0);
  assert.deepEqual(erros,[]);
  console.log('OK: fila offline persistente, reenvio após recarregar, separação por aluno, resposta perdida sem duplicação, falha de armazenamento, descarte confirmado; entrada protegida por blocos, cinco tags/cores, foto/iniciais, escolha/troca sem digitar, categorias, teclado, expiração, privacidade e layouts celular/tablet/PC.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(admin)await admin.dispose();if(navegador)await navegador.close();
  if(servidor){servidor.kill();await pausa(600);}
  const alvo=path.resolve(temporario);
  if(path.dirname(alvo)===path.resolve(os.tmpdir())&&path.basename(alvo).startsWith('modo-aluno-'))fs.rmSync(alvo,{recursive:true,force:true});
});
