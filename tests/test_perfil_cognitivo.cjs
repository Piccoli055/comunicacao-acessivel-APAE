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
const temporario=fs.mkdtempSync(path.join(os.tmpdir(),'perfil-cognitivo-'));
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
  const ana=await post('/api/alunos',{nome:'Ana fictícia',perfil_acessibilidade:'intelectual',foto:fs.readFileSync(fixture).toString('base64'),autorizado:true});
  const bruno=await post('/api/alunos',{nome:'Bruno fictício',autorizado:true});
  await post('/api/comunicadores/vincular',{dispositivo:'Tablet 01',aluno_id:ana.id,versao:0});
  navegador=await chromium.launch({headless:true,args:['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],...(process.env.TEST_BROWSER?{channel:process.env.TEST_BROWSER}:{})});
  const contexto=await navegador.newContext({viewport:{width:1024,height:768}});
  await contexto.addInitScript(() => {
    window.ensaioVoz={falas:[],cancelamentos:0};
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
      getVoices:()=>[{lang:'pt-BR',localService:true,name:'Voz fictícia'}],
      cancel:()=>window.ensaioVoz.cancelamentos++,
      speak:fala=>{window.ensaioVoz.falas.push({texto:fala.text,lang:fala.lang});window.ultimaFala=fala;},
    }});
    Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
  });
  let page=await contexto.newPage();page.setDefaultTimeout(20000);
  const erros=[];
  function observar(p){p.on('pageerror',e=>erros.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/Content Security Policy/i.test(m.text()))erros.push(m.text());});}
  observar(page);

  await contexto.addCookies((await admin.storageState()).cookies);
  await page.goto(url);
  await page.locator('#portal').waitFor({state:'visible'});await page.locator('#abrir-modo-aluno').click();
  await page.locator('#escolha-aluno').waitFor({state:'visible'});await page.waitForFunction(()=>!ocupado);
  await page.locator('[data-aluno="'+ana.id+'"]').click();await page.locator('#identidade').waitFor({state:'visible'});
  // A liberação revogou a sessão administrativa copiada; cria uma separada para as consultas do ensaio.
  await post('/api/login',{instituicao:'164275',usuario:'testedev',senha:'123456'});

  assert(await page.locator('body').evaluate(b=>b.classList.contains('perfil-cognitivo') && !b.classList.contains('baixa-visao') && !b.classList.contains('perfil-motor')));
  const essenciais=['agua','banheiro','comida','descanso','mal_estar','ajuda'];
  assert.deepEqual(await page.locator('#opcoes-comunicacao [data-mensagem]').evaluateAll(bs=>bs.map(b=>b.dataset.mensagem)),essenciais);
  assert.equal(await page.locator('#opcoes-comunicacao [data-categoria]').count(),0);
  assert.equal(await page.locator('#opcoes-comunicacao small').count(),0);
  assert(await page.locator('#mais-mensagens').isVisible());
  const catalogo=await (await contexto.request.get(url+'/api/aluno/catalogo')).json();
  const todas=[...catalogo.categorias.flatMap(c=>c.mensagens),catalogo.ajuda];
  for(const id of essenciais){
    await page.locator('[data-mensagem="'+id+'"]').click();
    assert.equal(await page.locator('#texto-mensagem').innerText(),todas.find(m=>m.id===id).frase);
    assert.equal(await page.locator('#titulo-confirmacao').innerText(),'Você escolheu:');
    assert.equal(await page.locator('#confirmar-mensagem').innerText(),'Enviar');
    await page.keyboard.press('Escape');
    assert(await page.locator('[data-mensagem="'+id+'"]').evaluate(n=>n===document.activeElement));
  }
  assert.equal((await (await admin.get('/api/pedidos')).json()).length,0);
  assert.equal((await page.evaluate(()=>ensaioVoz.falas)).length,0);
  fs.mkdirSync(path.join(raiz,'tmp'),{recursive:true});
  for(const [nome,width,height] of [['tablet',1024,768],['celular',390,844],['estreito',320,700],['pc',1366,900]]){
    await page.setViewportSize({width,height});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await capturar(page,{path:path.join(raiz,'tmp','cognitivo-inicio-'+nome+'.png'),fullPage:true});
  }
  await page.locator('#mais-mensagens').click();
  assert.equal(await page.locator('#titulo-comunicacao').innerText(),'Mais mensagens');
  const outras=await page.locator('#opcoes-comunicacao [data-mensagem]').evaluateAll(bs=>bs.map(b=>b.dataset.mensagem));
  assert.equal(outras.length,8);assert(outras.every(id=>!essenciais.includes(id)));
  assert.equal(new Set([...essenciais,...outras]).size,14);
  assert(await page.locator('#mais-mensagens').isHidden());
  await page.locator('[data-mensagem="sim"]').focus();await page.keyboard.press('Space');
  assert.equal(await page.locator('#texto-mensagem').innerText(),'Sim.');
  await page.locator('#voltar-mensagem').click();
  assert.equal(await page.locator('#titulo-comunicacao').innerText(),'Mais mensagens');
  await page.locator('#inicio-comunicacao').click();
  assert.equal(await page.locator('#opcoes-comunicacao button').count(),6);
  // Seleção imediata após navegação: este perfil não tem o intervalo motor.
  await page.locator('[data-mensagem="ajuda"]').click();assert(await page.locator('#selecao-mensagem').isVisible());
  await capturar(page,{path:path.join(raiz,'tmp','cognitivo-confirmacao.png'),fullPage:true});
  await page.locator('#confirmar-mensagem').click();
  await esperarCondicao(page,async()=>{const fila=await FilaAluno.listar();return !enviando && fila.length===0 && document.getElementById('resultado-envio').textContent==='Mensagem enviada';});
  let pedidos=await (await admin.get('/api/pedidos')).json();assert.equal(pedidos.length,1);assert.equal(pedidos[0].prioridade,'ajuda');
  await page.evaluate(()=>atualizar());assert.equal(await page.locator('#resultado-envio').innerText(),'Mensagem enviada');
  // Offline mantém um estado curto distinto de recebimento confirmado.
  await contexto.setOffline(true);
  await page.locator('[data-mensagem="agua"]').click();await page.locator('#confirmar-mensagem').click();
  await esperarCondicao(page,async()=>{const fila=await FilaAluno.listar();return !enviando && fila.length===1;});
  assert.equal(await page.locator('#resultado-envio').innerText(),'Aguardando envio');
  assert.equal(await page.locator('#resultado-envio').getAttribute('data-situacao'),'aguardando');
  await page.evaluate(()=>atualizar());assert.equal(await page.locator('#resultado-envio').innerText(),'Aguardando envio');
  await contexto.setOffline(false);
  await esperarCondicao(page,async()=>{const fila=await FilaAluno.listar();return !enviando && fila.length===0;});
  assert.equal(await page.locator('#resultado-envio').innerText(),'Mensagem enviada');
  assert.equal(await page.locator('#resultado-envio').getAttribute('data-situacao'),'enviado');
  assert.equal((await (await admin.get('/api/pedidos')).json()).length,2);
  // Nome/foto atualizados preservam a navegação das mensagens extras.
  await page.locator('#mais-mensagens').click();
  await post('/api/alunos/editar',{id:ana.id,versao:1,nome:'Ana revisada',perfil_acessibilidade:'intelectual',autorizado:true});
  await page.evaluate(()=>atualizar());assert.equal(await page.locator('#titulo-comunicacao').innerText(),'Mais mensagens');
  assert.equal(await page.locator('#opcoes-comunicacao button').count(),8);
  await page.locator('#trocar-aluno').click();await page.locator('#escolha-aluno').waitFor({state:'visible'});await page.waitForFunction(()=>!ocupado);
  await page.locator('[data-aluno="'+bruno.id+'"]').click();await page.locator('#identidade').waitFor({state:'visible'});
  assert.equal(await page.locator('body').evaluate(b=>b.classList.contains('perfil-cognitivo')),false);
  assert.equal(await page.locator('#opcoes-comunicacao button').count(),4);
  assert(await page.locator('#mais-mensagens').isHidden());
  await page.locator('[data-mensagem="ajuda"]').click();assert.equal(await page.locator('#confirmar-mensagem').innerText(),'Enviar mensagem');await page.keyboard.press('Escape');
  await post('/api/alunos/editar',{id:bruno.id,versao:1,nome:bruno.nome,perfil_acessibilidade:'intelectual',autorizado:true});
  await page.evaluate(()=>atualizar());assert.equal(await page.locator('#opcoes-comunicacao button').count(),6);
  assert.equal((await page.evaluate(()=>ensaioVoz.falas)).length,0);
  assert.deepEqual(erros,[]);
  console.log('OK técnico: seis essenciais diretos, oito extras, rótulos, teclado/foco, envio explícito, estados offline, ausência de voz, layouts e isolamento entre perfis. Validação de Eduardo e tablet pendentes.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(admin)await admin.dispose();if(navegador)await navegador.close();
  if(servidor){servidor.kill();await pausa(600);}
  const alvo=path.resolve(temporario);
  if(path.dirname(alvo)===path.resolve(os.tmpdir())&&path.basename(alvo).startsWith('perfil-cognitivo-'))fs.rmSync(alvo,{recursive:true,force:true});
});
