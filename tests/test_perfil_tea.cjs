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
const temporario=fs.mkdtempSync(path.join(os.tmpdir(),'perfil-tea-'));
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
  const ana=await post('/api/alunos',{nome:'Ana fictícia',perfil_acessibilidade:'tea',foto:fs.readFileSync(fixture).toString('base64'),autorizado:true});
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


  assert(await page.locator('body').evaluate(b=>b.classList.contains('perfil-tea') && !b.classList.contains('perfil-cognitivo') && !b.classList.contains('perfil-motor') && !b.classList.contains('baixa-visao')));
  assert.equal(await page.locator('#categorias-tea button').count(),3);
  assert.equal(await page.locator('#etapas-tea [aria-current=step]').getAttribute('data-etapa'),'escolher');
  assert(await page.locator('#mais-mensagens').isHidden());assert(await page.locator('#paginacao-baixa-visao').isHidden());
  const catalogo=await (await contexto.request.get(url+'/api/aluno/catalogo')).json();
  const mensagens=new Set();
  fs.mkdirSync(path.join(raiz,'tmp'),{recursive:true});
  for(const [nome,width,height] of [['tablet',1024,768],['retrato',768,1024],['celular',390,844],['estreito',320,700],['pc',1366,900]]){
    await page.setViewportSize({width,height});
    let posicaoAjuda;
    for(const categoria of catalogo.categorias){
      await page.locator('[data-categoria-tea="'+categoria.id+'"]').click();
      assert.equal(await page.locator('#titulo-comunicacao').innerText(),categoria.rotulo);
      assert.equal(await page.locator('#opcoes-comunicacao button').count(),categoria.mensagens.length+1);
      assert.equal(await page.locator('#categorias-tea [aria-pressed=true]').count(),1);
      assert.equal(await page.locator('[data-categoria-tea="'+categoria.id+'"]').getAttribute('aria-pressed'),'true');
      for(const id of await page.locator('#opcoes-comunicacao [data-mensagem]').evaluateAll(bs=>bs.map(b=>b.dataset.mensagem)))mensagens.add(id);
      const posicao=await page.locator('#opcoes-comunicacao').evaluate(g=>{
        const b=g.querySelector('[data-mensagem="ajuda"]').getBoundingClientRect(),r=g.getBoundingClientRect();return {x:b.x-r.x,y:b.y-r.y};
      });
      if(posicaoAjuda){if(Math.abs(posicao.y-posicaoAjuda.y)>=2)await capturar(page,{path:path.join(raiz,'tmp','tea-instabilidade.png'),fullPage:true});assert(Math.abs(posicao.x-posicaoAjuda.x)<2);assert(Math.abs(posicao.y-posicaoAjuda.y)<2,JSON.stringify({nome,categoria:categoria.id,anterior:posicaoAjuda,atual:posicao}));}
      posicaoAjuda=posicao;
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.equal(await page.locator('#opcoes-comunicacao button').first().evaluate(b=>getComputedStyle(b).animationName),'none');
    }
    await capturar(page,{path:path.join(raiz,'tmp','tea-grade-'+nome+'.png'),fullPage:true});
  }
  assert.equal(mensagens.size,14);
  // Teclado, foco, indicação de etapa e cancelamento preservam a categoria.
  await page.locator('[data-categoria-tea="sentimentos"]').focus();await page.keyboard.press('Enter');
  await page.locator('[data-mensagem="medo"]').focus();await page.keyboard.press('Space');
  assert.equal(await page.locator('#texto-mensagem').innerText(),'Estou com medo.');
  assert.equal(await page.locator('#etapas-tea-confirmacao [aria-current=step]').getAttribute('data-etapa'),'confirmar');
  assert.equal((await (await admin.get('/api/pedidos')).json()).length,0);
  await page.setViewportSize({width:1024,height:768});
  await capturar(page,{path:path.join(raiz,'tmp','tea-confirmacao.png'),fullPage:true});
  await page.keyboard.press('Escape');
  assert(await page.locator('[data-mensagem="medo"]').evaluate(b=>b===document.activeElement));
  assert.equal(await page.locator('#etapas-tea [aria-current=step]').getAttribute('data-etapa'),'escolher');
  assert.equal(await page.locator('#titulo-comunicacao').innerText(),'Sentimentos');
  // Offline: Resultado significa resultado visível, não recebimento presumido.
  await contexto.setOffline(true);
  await page.locator('[data-mensagem="ajuda"]').click();await page.locator('#confirmar-mensagem').click();
  await esperarCondicao(page,async()=>{const q=await FilaAluno.listar();return !enviando && q.length===1;});
  assert.equal(await page.locator('#etapas-tea [aria-current=step]').getAttribute('data-etapa'),'resultado');
  assert.equal(await page.locator('#resultado-envio').getAttribute('data-situacao'),'aguardando');
  assert.equal(await page.locator('#titulo-comunicacao').innerText(),'Sentimentos');
  assert.equal((await (await admin.get('/api/pedidos')).json()).length,0);
  await contexto.setOffline(false);
  await esperarCondicao(page,async()=>{const q=await FilaAluno.listar();return !enviando && q.length===0;});
  assert.equal(await page.locator('#etapas-tea [aria-current=step]').getAttribute('data-etapa'),'resultado');
  assert.equal(await page.locator('#resultado-envio').getAttribute('data-situacao'),'enviado');
  assert.equal(await page.locator('#titulo-comunicacao').innerText(),'Sentimentos');
  assert.equal((await (await admin.get('/api/pedidos')).json()).length,1);
  assert.equal((await page.evaluate(()=>ensaioVoz.falas)).length,0);
  await post('/api/alunos/editar',{id:ana.id,versao:1,nome:'Ana revisada',perfil_acessibilidade:'tea',autorizado:true});
  await page.evaluate(()=>atualizar());
  assert.equal(await page.locator('#titulo-comunicacao').innerText(),'Sentimentos');
  assert.equal(await page.locator('#etapas-tea [aria-current=step]').getAttribute('data-etapa'),'resultado');
  // Nova escolha inicia a próxima sequência sem o intervalo do perfil motor.
  await page.locator('[data-categoria-tea="conversar"]').click();await page.locator('[data-mensagem="sim"]').click();
  assert(await page.locator('#selecao-mensagem').isVisible());assert.equal(await page.locator('#texto-mensagem').innerText(),'Sim.');
  await page.locator('#voltar-mensagem').click();
  await page.locator('#trocar-aluno').click();await page.locator('#escolha-aluno').waitFor({state:'visible'});await page.waitForFunction(()=>!ocupado);
  await page.locator('[data-aluno="'+bruno.id+'"]').click();await page.locator('#identidade').waitFor({state:'visible'});
  assert.equal(await page.locator('body').evaluate(b=>b.classList.contains('perfil-tea')),false);
  assert(await page.locator('#etapas-tea').isHidden());assert(await page.locator('#categorias-tea').isHidden());
  assert.equal(await page.locator('#opcoes-comunicacao button').count(),4);
  await post('/api/alunos/editar',{id:bruno.id,versao:1,nome:bruno.nome,perfil_acessibilidade:'tea',autorizado:true});
  await page.evaluate(()=>atualizar());assert(await page.locator('#categorias-tea').isVisible());assert.equal(await page.locator('#titulo-comunicacao').innerText(),'Necessidades');
  assert.deepEqual(erros,[]);
  console.log('OK técnico: TEA automático, categorias persistentes, Ajuda estável em cinco larguras, 14 mensagens, etapas, teclado, confirmação, offline, silêncio e isolamento entre perfis. Validação de Eduardo e tablet pendentes.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(admin)await admin.dispose();if(navegador)await navegador.close();
  if(servidor){servidor.kill();await pausa(600);}
  const alvo=path.resolve(temporario);
  if(path.dirname(alvo)===path.resolve(os.tmpdir())&&path.basename(alvo).startsWith('perfil-tea-'))fs.rmSync(alvo,{recursive:true,force:true});
});
