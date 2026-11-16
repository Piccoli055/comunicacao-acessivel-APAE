// Cadastro e acesso de tutores em dados temporários, sem alterar a instalação real.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const {chromium,request}=require('playwright');
const http=require('node:http');
const raiz=path.join(__dirname,'..'),python=process.env.PYTHON_TEST||'python';
const temporario=fs.mkdtempSync(path.join(os.tmpdir(),'tutores-mvp-'));
let servidor,navegador,admin,paginaDiagnostico;
const pausa=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const porta=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const url='http://127.0.0.1:'+porta;
 servidor=spawn(python,['-B','servidor.py','--demo','--porta',String(porta),'--dados',path.join(temporario,'dados')],{cwd:raiz,stdio:'ignore',windowsHide:true});
 let pronto=false;for(let i=0;i<80;i++){pronto=await new Promise(resolve=>{const req=http.get(url,res=>{res.resume();res.on('end',()=>resolve(res.statusCode===200));});req.on('error',()=>resolve(false));req.setTimeout(1500,()=>{req.destroy();resolve(false);});});if(pronto)break;await pausa(200);}assert(pronto);
 admin=await request.newContext({baseURL:url,extraHTTPHeaders:{'X-Portal':'tutora'}});
 async function post(rota,dados){const r=await admin.post(rota,{data:dados});assert(r.ok(),await r.text());return r.json();}
 await post('/api/login',{instituicao:'164275',usuario:'testedev',senha:'123456'});
 const ana=await post('/api/alunos',{nome:'Ana fictícia',autorizado:true}),bruno=await post('/api/alunos',{nome:'Bruno fictício',autorizado:true});
 for(const [aluno,sala,id] of [[ana,'Sala 1','pedido-ana'],[bruno,'Sala 2','pedido-bruno']]){
  await post('/api/comunicadores/vincular',{dispositivo:sala,aluno_id:aluno.id,versao:0});
  await post('/api/pedidos',{id,frase:'Quero água.',dispositivo:sala});
 }
 navegador=await chromium.launch({headless:true,args:['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],...(process.env.TEST_BROWSER?{channel:process.env.TEST_BROWSER}:{})});
 const contexto=await navegador.newContext({viewport:{width:1366,height:900}}),page=await contexto.newPage();page.setDefaultTimeout(20000);paginaDiagnostico=page;
 const erros=[];page.on('pageerror',e=>erros.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/Content Security Policy/i.test(m.text()))erros.push(m.text());});
 async function login(usuario,senha){await page.goto(url);await page.locator('#instituicao').fill('164275');await page.locator('#usuario').fill(usuario);await page.locator('#senha').fill(senha);await page.locator('#senha').press('Enter');await page.locator('#portal').waitFor({state:'visible'});}
 await login('testedev','123456');await page.locator('#nav-tutores').click();
 await page.waitForFunction(()=>document.getElementById('quantidade-tutores').textContent==='Nenhum tutor cadastrado.');
 await page.locator('#novo-tutor').click();await page.locator('#tutor-nome').fill('Liliane');await page.locator('#tutor-usuario').fill('liliane');await page.locator('#tutor-senha').fill('123');
 await page.locator('#alunos-tutor input[value="'+ana.id+'"]').check();
 fs.mkdirSync(path.join(raiz,'tmp'),{recursive:true});
 for(const [nome,width,height] of [['pc',1366,900],['celular',390,844]]){
  await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(raiz,'tmp','tutores-cadastro-'+nome+'.png'),fullPage:true});
 }
 await page.locator('#salvar-tutor').click();await page.locator('#formulario-tutor').waitFor({state:'hidden'});
 await page.getByRole('heading',{name:'Liliane',exact:true}).waitFor();
 await page.locator('#novo-tutor').click();await page.locator('#tutor-nome').fill('Outra tutora');await page.locator('#tutor-usuario').fill('outra');await page.locator('#tutor-senha').fill('123');await page.locator('#alunos-tutor input[value="'+bruno.id+'"]').check();
 await page.locator('#salvar-tutor').click();await page.locator('#formulario-tutor').waitFor({state:'hidden'});await page.getByRole('heading',{name:'Outra tutora',exact:true}).waitFor();
 await page.locator('#sair').click();await page.locator('#entrada').waitFor({state:'visible'});await login('liliane','123');
 await page.waitForFunction(()=>document.querySelectorAll('#pedidos .pedido').length===1);
 assert.match(await page.locator('#perfil-usuario').innerText(),/Liliane/);assert(await page.locator('#nav-tutores').isHidden());
 assert.equal(await page.locator('#pedidos .aluno-pedido-nome').innerText(),'Ana fictícia');assert.equal(await page.locator('#pedidos .selo.responsavel').innerText(),'Responsável');assert.equal(await page.locator('#badge-pendentes').innerText(),'1');
 await page.locator('#nav-historico').click();assert.equal(await page.locator('#pedidos .registro-historico').count(),2);
 assert.match(await page.locator('#pedidos').innerText(),/Outra tutora/);assert.equal(await page.locator('#pedidos button').count(),0);
 const tentativa=await contexto.request.post(url+'/api/confirmar',{data:{id:'pedido-bruno'},headers:{'X-Portal':'tutora'}});assert.equal(tentativa.status(),403);
 await page.locator('#nav-pendentes').click();await page.getByRole('button',{name:/Confirmar recebimento:/}).click();
 await page.getByRole('button',{name:/Marcar como atendido:/}).waitFor();await page.getByRole('button',{name:/Marcar como atendido:/}).click();await page.locator('#vazio').waitFor({state:'visible'});
 await page.locator('#nav-historico').click();assert.equal(await page.locator('#pedidos .registro-historico').count(),2);
 await page.reload();await page.locator('#portal').waitFor({state:'visible'});assert.match(await page.locator('#perfil-usuario').innerText(),/Liliane/);
 await page.locator('#sair').click();await page.locator('#entrada').waitFor({state:'visible'});await login('testedev','123456');
 const livre=await post('/api/alunos',{nome:'Aluno livre fictício',autorizado:true});
 await post('/api/comunicadores/vincular',{dispositivo:'Sala livre',aluno_id:livre.id,versao:0});
 await post('/api/pedidos',{id:'pedido-livre',frase:'Quero descansar.',dispositivo:'Sala livre'});
 await page.locator('#nav-pendentes').click();
 await page.locator('#pedidos').getByText('Aluno livre fictício',{exact:true}).waitFor();
 const aleatorio=page.locator('#pedidos .pedido').filter({has:page.getByText('Aluno livre fictício',{exact:true})});
 const responsavel=page.locator('#pedidos .pedido').filter({has:page.getByText('Bruno fictício',{exact:true})});
 assert.equal(await aleatorio.locator('.selo.responsavel').count(),0);
 assert.equal(await responsavel.locator('.selo.responsavel').innerText(),'Responsável');
 const antes=(await (await admin.get('/api/pedidos')).json()).find(p=>p.id==='pedido-livre');
 assert.equal(antes.encaminhamento,'aleatorio');assert.equal(antes.tutores.length,1);
 await page.screenshot({path:path.join(raiz,'tmp','tutores-encaminhamento-pendentes.png'),fullPage:true});
 await page.locator('#nav-historico').click();
 const registroLivre=page.locator('#pedidos .registro-historico').filter({has:page.getByText('Aluno livre fictício',{exact:true})});
 assert.equal(await registroLivre.locator('.selo.responsavel').count(),0);
 const registroVinculado=page.locator('#pedidos .registro-historico').filter({has:page.getByText('Ana fictícia',{exact:true})});
 assert.equal(await registroVinculado.locator('.selo.responsavel').innerText(),'Responsável');
 assert.deepEqual((await (await admin.get('/api/pedidos')).json()).find(p=>p.id==='pedido-livre').tutores,antes.tutores);
 await page.locator('#nav-tutores').click();await page.getByRole('button',{name:'Editar tutor: Liliane',exact:true}).waitFor();await page.getByRole('button',{name:'Editar tutor: Liliane',exact:true}).click();
 assert.equal(await page.locator('#tutor-senha').inputValue(),'');await page.locator('#tutor-ativo').uncheck();await page.locator('#salvar-tutor').click();await page.locator('#formulario-tutor').waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.getElementById('lista-tutores').textContent.includes('Inativo'));
 assert.deepEqual(erros,[]);
 console.log('OK: cadastro no portal, senha 123 no demo, vínculos de alunos, login Liliane, pendentes próprios, histórico de todos, sorteio persistente, tag Responsável, ações protegidas e edição/desativação; PC e celular.');
})().catch(async e=>{console.error(e);if(paginaDiagnostico){try{fs.mkdirSync(path.join(raiz,'tmp'),{recursive:true});await paginaDiagnostico.screenshot({path:path.join(raiz,'tmp','tutores-falha.png'),fullPage:true});console.error(await paginaDiagnostico.evaluate(()=>({url:location.href,loginVisivel:!document.getElementById('entrada').hidden,portalVisivel:!document.getElementById('portal').hidden,entrarDesabilitado:document.getElementById('conectar').disabled,erro:document.getElementById('erro').textContent})));}catch(_){}}process.exitCode=1;}).finally(async()=>{
 if(admin)await admin.dispose();if(navegador)await navegador.close();if(servidor){servidor.kill();await pausa(600);}
 const alvo=path.resolve(temporario);if(path.dirname(alvo)===path.resolve(os.tmpdir())&&path.basename(alvo).startsWith('tutores-mvp-'))fs.rmSync(alvo,{recursive:true,force:true});
});
