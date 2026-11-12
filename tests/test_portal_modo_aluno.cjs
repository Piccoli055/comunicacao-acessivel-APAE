// Ensaio do modo aluno em banco temporário; não altera a instalação real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn,spawnSync} = require('node:child_process');
const {chromium,request} = require('playwright');
const raiz=path.join(__dirname,'..'), python=process.env.PYTHON_TEST || 'python';
const temporario=fs.mkdtempSync(path.join(os.tmpdir(),'modo-aluno-'));
let servidor,navegador,admin;
const pausa=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const porta=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const url='http://127.0.0.1:'+porta;
  servidor=spawn(python,['-B','servidor.py','--demo','--porta',String(porta),'--dados',path.join(temporario,'dados')],{cwd:raiz,stdio:'ignore',windowsHide:true});
  let pronto=false;
  for(let i=0;i<80;i++){try{pronto=(await fetch(url)).ok;}catch(_){}if(pronto)break;await pausa(200);}
  assert(pronto,'Servidor não iniciou');
  admin=await request.newContext({baseURL:url,extraHTTPHeaders:{'X-Portal':'tutora'}});
  async function post(rota,dados){const r=await admin.post(rota,{data:dados});assert(r.ok(),await r.text());return r.json();}
  await post('/api/login',{instituicao:'164275',usuario:'testedev',senha:'123456'});
  const fixture=path.join(temporario,'foto.png');
  const foto=spawnSync(python,['-c',"from PIL import Image; import sys; Image.new('RGB',(100,100),'teal').save(sys.argv[1])",fixture],{windowsHide:true});
  assert.equal(foto.status,0);
  const ana=await post('/api/alunos',{nome:'Ana fictícia',perfil_acessibilidade:'baixa_visao',foto:fs.readFileSync(fixture).toString('base64'),autorizado:true});
  const bruno=await post('/api/alunos',{nome:'Bruno fictício',autorizado:true});
  await post('/api/comunicadores/vincular',{dispositivo:'Tablet 01',aluno_id:ana.id,versao:0});
  navegador=await chromium.launch({headless:true,...(process.env.TEST_BROWSER?{channel:process.env.TEST_BROWSER}:{})});
  const contexto=await navegador.newContext({viewport:{width:1024,height:768}});
  const page=await contexto.newPage();page.setDefaultTimeout(10000);
  const erros=[];page.on('pageerror',e=>erros.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/Content Security Policy/i.test(m.text()))erros.push(m.text());});
  await page.goto(url+'/aluno');
  await page.locator('#acesso-entrada').waitFor({state:'visible'});
  assert.equal(await page.locator('#blocos-alunos button').count(),0);
  await page.goto(url);
  await page.locator('#instituicao').fill('164275');await page.locator('#usuario').fill('testedev');await page.locator('#senha').fill('123456');await page.locator('#conectar').click();
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
    await page.screenshot({path:path.join(raiz,'tmp','acesso-portal-aluno-'+nome+'.png'),fullPage:true});
  }
  await page.setViewportSize({width:1024,height:768});
  for(const [perfil,nome] of [['tea','Carla fictícia'],['motora','Daniel fictício'],['intelectual','Elisa fictícia']])await post('/api/alunos',{nome,perfil_acessibilidade:perfil,autorizado:true});
  await page.locator('#abrir-modo-aluno').click();
  await page.locator('#escolha-aluno').waitFor({state:'visible'});await page.waitForFunction(()=>!ocupado);
  await page.waitForFunction(()=>document.querySelectorAll('#blocos-alunos button').length===5);
  assert.equal(await page.locator('#escolha-aluno input').count(),0);
  assert.equal(await page.locator('#configuracao').count(),0);
  assert.equal((await contexto.request.get(url+'/api/sessao')).status(),401);
  assert.equal((await admin.get('/api/sessao')).status(),200);
  for(const cor of ['azul','roxo','ambar','verde','neutro'])assert.equal(await page.locator('.tag-aluno.cor-'+cor).count(),1);
  fs.mkdirSync(path.join(raiz,'tmp'),{recursive:true});
  for(const [nome,width,height] of [['tablet',1024,768],['celular',390,844],['pc',1366,900],['estreito',320,700]]){
    await page.setViewportSize({width,height});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),nome+' com rolagem horizontal');
    await page.screenshot({path:path.join(raiz,'tmp','entrada-alunos-'+nome+'.png'),fullPage:true});
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
    }
    for(const [nome,width,height] of [['tablet',1024,768],['celular',390,844],['pc',1366,900]]){
      await page.setViewportSize({width,height});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),categoria.id+' / '+nome+' com rolagem horizontal');
      const tamanhos=await page.locator('#opcoes-comunicacao button').evaluateAll(bs=>bs.map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height})));
      assert(tamanhos.every(t=>t.w>=100&&t.h>=150));
      await page.screenshot({path:path.join(raiz,'tmp','modo-aluno-'+categoria.id+'-'+nome+'.png'),fullPage:true});
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
  const foco=await page.locator('[data-mensagem="agua"]').evaluate(n=>n===document.activeElement);
  assert(foco);
  await page.evaluate(()=>atualizar());
  assert.equal(await page.locator('#nome-aluno').innerText(),'Ana fictícia revisada');
  assert.equal(await page.locator('#titulo-comunicacao').innerText(),'Necessidades');
  assert.equal(await page.locator('#texto-mensagem').innerText(),'Quero água.');
  assert(await page.locator('[data-mensagem="agua"]').evaluate(n=>n===document.activeElement));
  assert.deepEqual(envios,[]);
  assert.equal((await (await admin.get('/api/pedidos')).json()).length,0);
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
  await post('/api/alunos/situacao',{id:bruno.id,versao:1,ativo:false,confirmado:true});
  await page.locator('#atualizar').click();await page.locator('#vinculo-pendente').waitFor({state:'visible'});
  assert.equal(await page.locator('#titulo-pendente').innerText(),'Cadastro inativo');
  assert.equal(await page.locator('#nome-aluno').innerText(),'');
  await page.locator('#trocar-aluno').click();
  await page.locator('#escolha-aluno').waitFor({state:'visible'});await page.waitForFunction(()=>!ocupado);
  assert.equal(await page.locator('[data-aluno="'+bruno.id+'"]').count(),0);
  await page.locator('[data-aluno="'+ana.id+'"]').click();
  await page.locator('#identidade').waitFor({state:'visible'});
  await page.route('**/api/aluno/perfil',r=>r.abort());
  await page.evaluate(()=>atualizar());
  assert(await page.locator('#falha-conexao').isVisible());
  assert.equal(await page.locator('#nome-aluno').innerText(),'');
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
  console.log('OK: entrada protegida por blocos, cinco tags/cores, foto/iniciais, escolha/troca sem digitar, categorias, teclado, expiração, privacidade e layouts celular/tablet/PC.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(admin)await admin.dispose();if(navegador)await navegador.close();
  if(servidor){servidor.kill();await pausa(600);}
  const alvo=path.resolve(temporario);
  if(path.dirname(alvo)===path.resolve(os.tmpdir())&&path.basename(alvo).startsWith('modo-aluno-'))fs.rmSync(alvo,{recursive:true,force:true});
});
