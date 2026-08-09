'use strict';
/* ================= Almacenamiento: IndexedDB con respaldo automático en localStorage ================= */
const DB_NAME='leonides_pos', DB_VERSION=1;
const stores=['productos','ventas','clientes','abonos'];
let db=null, usarLocalStorage=false, lsData=null;
const LS_KEY='leonides_pos_data_v1';

function abrirDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains('productos')){
        const s=d.createObjectStore('productos',{keyPath:'id',autoIncrement:true});
        s.createIndex('codigo','codigo');
      }
      if(!d.objectStoreNames.contains('ventas')){
        const s=d.createObjectStore('ventas',{keyPath:'id',autoIncrement:true});
        s.createIndex('fecha','fecha');
      }
      if(!d.objectStoreNames.contains('clientes'))
        d.createObjectStore('clientes',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('abonos')){
        const s=d.createObjectStore('abonos',{keyPath:'id',autoIncrement:true});
        s.createIndex('clienteId','clienteId');
      }
    };
    r.onsuccess=e=>res(e.target.result);
    r.onerror=e=>rej(e.target.error);
    r.onblocked=()=>rej(new Error('bloqueado'));
  });
}
function req(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
function st(n,m){return db.transaction(n,m||'readonly').objectStore(n);}

function cargarLS(){
  try{lsData=JSON.parse(localStorage.getItem(LS_KEY));}catch(e){lsData=null;}
  if(!lsData||!Array.isArray(lsData.productos))
    lsData={productos:[],ventas:[],clientes:[],abonos:[],seq:{productos:0,ventas:0,clientes:0,abonos:0}};
  stores.forEach(s=>{if(!Array.isArray(lsData[s]))lsData[s]=[];if(!lsData.seq)lsData.seq={};if(lsData.seq[s]==null)lsData.seq[s]=0;});
}
function guardarLS(){try{localStorage.setItem(LS_KEY,JSON.stringify(lsData));}catch(e){toast('⚠️ No se pudo guardar: almacenamiento lleno');}}

async function dbGetAll(n){
  if(usarLocalStorage)return (lsData[n]||[]).map(x=>({...x}));
  return req(st(n).getAll());
}
async function dbGet(n,k){
  if(usarLocalStorage)return (lsData[n]||[]).find(x=>x.id===k);
  return req(st(n).get(k));
}
async function dbPut(n,v){
  if(usarLocalStorage){
    const obj={...v};
    if(obj.id==null){lsData.seq[n]=(lsData.seq[n]||0)+1;obj.id=lsData.seq[n];}
    else lsData.seq[n]=Math.max(lsData.seq[n]||0,obj.id);
    const i=lsData[n].findIndex(x=>x.id===obj.id);
    if(i>=0)lsData[n][i]=obj;else lsData[n].push(obj);
    guardarLS();
    return obj.id;
  }
  return req(st(n,'readwrite').put(v));
}
async function dbDel(n,k){
  if(usarLocalStorage){lsData[n]=lsData[n].filter(x=>x.id!==k);guardarLS();return;}
  return req(st(n,'readwrite').delete(k));
}
async function dbClear(n){
  if(usarLocalStorage){lsData[n]=[];guardarLS();return;}
  return req(st(n,'readwrite').clear());
}
async function buscarPorCodigo(c){
  if(usarLocalStorage)return (lsData.productos||[]).find(x=>x.codigo===c);
  return req(st('productos').index('codigo').get(c));
}

/* ================= Utilidades ================= */
const $=id=>document.getElementById(id);
const fmt=n=>(n||0).toLocaleString('es-MX',{style:'currency',currency:'MXN'});
const fmtF=ts=>new Date(ts).toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'});
function fmtCorto(n){return n>=1000?'$'+(n/1000).toFixed(1).replace(/\.0$/,'')+'k':'$'+Math.round(n);}
function inicioDia(ts){const d=new Date(ts);d.setHours(0,0,0,0);return d.getTime();}
function fechaLocal(d){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),dd=String(d.getDate()).padStart(2,'0');return y+'-'+m+'-'+dd;}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
let toastH=null;
function toast(msg,ms){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastH);toastH=setTimeout(()=>t.classList.remove('show'),ms||2200);}
function abrirModal(id){$(id).classList.add('open');}
function cerrarModal(id){$(id).classList.remove('open');}
document.addEventListener('click',e=>{
  if(e.target.classList&&e.target.classList.contains('modal')){
    if(e.target.id==='mScanner')cerrarScanner();else e.target.classList.remove('open');
  }
});
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&document.activeElement&&document.activeElement.id==='scanManual')enviarCodigoManual();
});

const CATS=[
  {id:'ilusion',nombre:'Lencería Ilusión',emoji:'👙',color:'#ec4899'},
  {id:'fraiche',nombre:'Perfume Fraiche',emoji:'🌺',color:'#8b5cf6'},
  {id:'cosmeticos',nombre:'Cosméticos',emoji:'💄',color:'#f59e0b'},
  {id:'otros',nombre:'Otros',emoji:'📦',color:'#6b7280'}
];
const catInfo=id=>CATS.find(c=>c.id===id)||CATS[3];
const FREQ_TXT={semanal:'Cada semana',quincenal:'Cada quincena',mensual:'Cada mes'};

/* ================= Guías interactivas ================= */
const TOUR_KEY='leonides_tours_v1';
let vistaActual='ventas', tourActiva=null;

function toursVistos(){try{return JSON.parse(localStorage.getItem(TOUR_KEY))||{};}catch(e){return{};}}
function marcarTourVisto(id){try{const t=toursVistos();t[id]=true;localStorage.setItem(TOUR_KEY,JSON.stringify(t));}catch(e){}}
function reiniciarGuias(){try{localStorage.removeItem(TOUR_KEY);}catch(e){}toast('💡 Las guías volverán a mostrarse al entrar a cada sección');}

const TOUR_STEPS={
  ventas:[
    {t:'🛒 ¡Bienvenida a Ventas!',x:'Aquí registras cada venta en 3 pasos: busca el producto, agrégalo al carrito y cobra. Te enseño rápido 👇'},
    {t:'🔍 Buscar o escanear',x:'Escribe el nombre del producto o toca <b>📷 Escanear</b> para leer su código de barras con la cámara.',el:'#filaBusqueda'},
    {t:'💵 Cobrar o fiar',x:'Aquí ves el total del carrito. Toca <b>Contado</b> si pagan en efectivo, o <b>Fiado</b> para elegir cliente, pedir <b>abono inicial</b> y definir el <b>plan de pago</b> (1 pago o en partes, con fecha de próximo pago).',el:'#carritoCard'},
    {t:'➕ Tus productos',x:'Toca el botón <b>＋</b> de cada producto para agregarlo al carrito. Puedes llevar varios a la vez.',el:'#listaVentaProductos'},
    {t:'🌸 ¡Lista para vender!',x:'Cuando necesites ayuda, toca el botón flotante <b>💡</b> para repetir esta guía. ¡Mucho éxito!'}
  ],
  productos:[
    {t:'📦 Tus productos',x:'Aquí das de alta todo lo que vendes: lencería Ilusión, perfumes Fraiche y cosméticos.'},
    {t:'➕ Nuevo producto',x:'Busca un producto o toca <b>＋ Nuevo</b> para crearlo. Puedes escribir sus datos o <b>escanear su código</b> 📷.',el:'#cardBusquedaProd'},
    {t:'✏️ Editar y surtir',x:'Toca cualquier producto para cambiar precio, costo y existencia. Al recibir mercancía usa los botones <b>+1, +5 y +10</b>.',el:'#listaProductos'},
    {t:'💡 Ayuda',x:'Toca el botón <b>💡</b> cuando quieras repetir esta guía.'}
  ],
  fiados:[
    {t:'📓 Cuentas por cobrar',x:'Aquí ves <b>quién te debe, cuánto y desde qué fecha</b>. Todas las cuentas en un solo lugar.'},
    {t:'💰 Total por cobrar',x:'Esta es la suma de todo lo que te deben entre todos tus clientes.',el:'#cardPorCobrar'},
    {t:'👤 Cada cliente',x:'Toca un cliente para ver su <b>plan de pago</b>, la <b>fecha del próximo pago</b> (te aviso si está atrasado ⚠️), registrar <b>abonos 💰</b> o mandar <b>recordatorio por WhatsApp 📱</b>.',el:'#listaFiados'},
    {t:'💡 Ayuda',x:'El botón <b>💡</b> repite esta guía cuando la necesites.'}
  ],
  dashboard:[
    {t:'📊 El resumen del negocio',x:'Aquí ves cómo va todo de un vistazo, sin hacer cuentas a mano.'},
    {t:'💵 Tus números del día',x:'Ingresos de hoy (ventas + abonos), ventas del día, lo que te deben y el valor de tu inventario.',el:'#gridStats'},
    {t:'📈 Últimos 7 días',x:'Esta gráfica muestra cuánto vendiste cada día de la última semana.',el:'#cardChart'},
    {t:'⚠️ Stock bajo',x:'Aquí te aviso qué productos se están acabando para que los resurtas a tiempo.',el:'#cardStockBajo'},
    {t:'💡 Ayuda',x:'Toca <b>💡</b> para repetir esta guía cuando quieras.'}
  ],
  ajustes:[
    {t:'⚙️ Ajustes y respaldos',x:'Esta sección es muy importante: aquí cuidas tu información.'},
    {t:'💾 Respaldo',x:'Con <b>Exportar</b> guardas todo (productos, ventas, clientes y abonos) en un archivo que puedes mandarte por WhatsApp. Con <b>Importar</b> lo restauras en este u otro teléfono.',el:'#cardRespaldo'},
    {t:'💡 Guías',x:'Aquí puedes volver a ver las guías de cada sección o reiniciarlas.',el:'#cardGuias'},
    {t:'⚠️ Cuidado',x:'La zona de peligro borra todo. Antes de borrar, siempre exporta un respaldo primero.',el:'#cardPeligro'}
  ]
};

function iniciarTour(seccion,forzar){
  const defs=TOUR_STEPS[seccion];
  if(!defs||!defs.length)return;
  if(!forzar&&toursVistos()[seccion])return;
  if(tourActiva)tourActiva.cancel(false);

  const wrap=document.createElement('div');
  wrap.id='tourWrap';
  wrap.innerHTML='<div id="tourSpot"></div>'+
    '<div id="tourCard">'+
      '<button id="tourCerrar">✕</button>'+
      '<div id="tourTitulo"></div>'+
      '<div id="tourTexto"></div>'+
      '<div id="tourPie">'+
        '<span id="tourContador"></span>'+
        '<div style="display:flex;gap:8px">'+
          '<button id="tourAtras" class="tour-btn tour-btn-sec">Atrás</button>'+
          '<button id="tourSig" class="tour-btn">Siguiente</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  document.body.appendChild(wrap);

  const spot=$('tourSpot'), card=$('tourCard');
  let idx=0, cerrado=false;

  function colocar(){
    if(cerrado)return;
    const paso=defs[idx];
    const vh=window.innerHeight;
    let target=paso.el?document.querySelector(paso.el):null;
    if(target&&target.getBoundingClientRect().height>vh*0.6)target=null;
    if(target){
      const r=target.getBoundingClientRect(), pad=6;
      spot.style.display='block';
      spot.style.left=Math.max(r.left-pad,4)+'px';
      spot.style.top=(r.top-pad)+'px';
      spot.style.width=(r.width+pad*2)+'px';
      spot.style.height=(r.height+pad*2)+'px';
      card.style.left='12px';card.style.right='12px';
      const altoCard=card.offsetHeight;
      if(r.bottom+altoCard+26<=vh){
        card.style.top=(r.bottom+14)+'px';card.style.bottom='auto';card.style.transform='none';
      }else if(r.top-altoCard-26>0){
        card.style.top='auto';card.style.bottom=(vh-r.top+14)+'px';card.style.transform='none';
      }else{
        card.style.top='50%';card.style.bottom='auto';card.style.transform='translateY(-50%)';
      }
    }else{
      spot.style.display='none';
      card.style.left='12px';card.style.right='12px';
      card.style.top='50%';card.style.bottom='auto';card.style.transform='translateY(-50%)';
    }
  }

  function mostrarPaso(){
    const paso=defs[idx];
    $('tourTitulo').textContent=paso.t;
    $('tourTexto').innerHTML=paso.x;
    $('tourContador').textContent=(idx+1)+' / '+defs.length;
    $('tourAtras').style.display=idx===0?'none':'block';
    $('tourSig').textContent=idx===defs.length-1?'¡Listo! ✓':'Siguiente';
    const target=paso.el?document.querySelector(paso.el):null;
    if(target)target.scrollIntoView({behavior:'smooth',block:'center'});
    colocar();
  }

  function cerrar(marcar){
    if(cerrado)return;cerrado=true;
    if(marcar!==false)marcarTourVisto(seccion);
    window.removeEventListener('scroll',colocar,true);
    window.removeEventListener('resize',colocar);
    wrap.remove();
    if(tourActiva&&tourActiva._wrap===wrap)tourActiva=null;
  }

  $('tourCerrar').onclick=()=>cerrar(true);
  $('tourAtras').onclick=()=>{if(idx>0){idx--;mostrarPaso();}};
  $('tourSig').onclick=()=>{if(idx<defs.length-1){idx++;mostrarPaso();}else cerrar(true);};
  window.addEventListener('scroll',colocar,true);
  window.addEventListener('resize',colocar);

  tourActiva={cancel:cerrar,_wrap:wrap};
  mostrarPaso();
}

/* ================= Navegación ================= */
function mostrarVista(nombre){
  if(tourActiva)tourActiva.cancel(false);
  vistaActual=nombre;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $('v-'+nombre).classList.add('active');
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.v===nombre));
  if(nombre==='ventas')renderVentaProductos();
  if(nombre==='productos')renderProductos();
  if(nombre==='fiados')renderFiados();
  if(nombre==='dashboard')renderDashboard();
  if(nombre==='ajustes')renderStats();
  window.scrollTo(0,0);
  setTimeout(()=>iniciarTour(nombre,false),550);
}

/* ================= Escáner ================= */
let scanStream=null,scanTimer=null,scanTarget='venta';
async function abrirScanner(target){
  scanTarget=target;
  $('scanError').textContent='';
  $('scanMsg').textContent='Abriendo cámara…';
  $('scanManual').value='';
  abrirModal('mScanner');
  const video=$('scanVideo');
  try{
    scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
    video.srcObject=scanStream;
    await video.play();
  }catch(e){
    $('scanError').textContent='No se pudo abrir la cámara. Escribe el código abajo.';
    $('scanMsg').textContent='';
    return;
  }
  if('BarcodeDetector' in window){
    try{
      const soportados=await BarcodeDetector.getSupportedFormats();
      const pref=['ean_13','ean_8','code_128','code_39','upc_a','upc_e','itf','codabar','qr_code'];
      const formats=pref.filter(f=>soportados.includes(f));
      const detector=new BarcodeDetector(formats.length?{formats}:undefined);
      $('scanMsg').textContent='Apunta al código de barras…';
      scanTimer=setInterval(async()=>{
        if(video.readyState>=2){
          try{
            const codigos=await detector.detect(video);
            if(codigos.length){
              const valor=codigos[0].rawValue;
              if(navigator.vibrate)navigator.vibrate(80);
              cerrarScanner();
              procesarCodigo(valor);
            }
          }catch(e){}
        }
      },250);
    }catch(e){
      $('scanMsg').textContent='Escribe el código abajo (escáner no disponible):';
    }
  }else{
    $('scanMsg').textContent='Este navegador no tiene escáner automático. Escribe el código abajo:';
  }
}
function cerrarScanner(){
  clearInterval(scanTimer);scanTimer=null;
  if(scanStream){scanStream.getTracks().forEach(t=>t.stop());scanStream=null;}
  cerrarModal('mScanner');
}
function enviarCodigoManual(){
  const v=$('scanManual').value.trim();
  if(!v){toast('Escribe un código');return;}
  cerrarScanner();
  procesarCodigo(v);
}
async function procesarCodigo(codigo){
  codigo=(codigo||'').trim();
  if(!codigo)return;
  if(scanTarget==='producto-codigo'){
    $('fCodigo').value=codigo;
    const p=await buscarPorCodigo(codigo);
    if(p&&confirm('Ya existe "'+p.nombre+'" con este código. ¿Editarlo?')){editarProducto(p.id);return;}
    toast('Código capturado: '+codigo);
    return;
  }
  const p=await buscarPorCodigo(codigo);
  if(p){
    agregarCarrito(p.id);
    toast('✅ '+p.nombre+' agregado');
  }else if(confirm('No hay producto con el código '+codigo+'. ¿Darlo de alta?')){
    mostrarVista('productos');
    nuevoProducto(codigo);
  }
}

/* ================= Carrito y ventas ================= */
let carrito=[];
const totalCarrito=()=>carrito.reduce((s,i)=>s+i.precio*i.cantidad,0);

async function agregarCarrito(id){
  const p=await dbGet('productos',id);
  if(!p)return;
  const it=carrito.find(i=>i.productoId===id);
  if(it)it.cantidad++;
  else carrito.push({productoId:id,codigo:p.codigo||'',nombre:p.nombre,precio:p.precio,categoria:p.categoria||'otros',cantidad:1});
  const actual=carrito.find(i=>i.productoId===id);
  if((p.stock!=null&&p.stock>0)&&actual.cantidad>p.stock)toast('⚠️ Solo hay '+p.stock+' en stock');
  renderCarrito();
}
function cambiarQty(idx,d){
  const it=carrito[idx];if(!it)return;
  it.cantidad+=d;
  if(it.cantidad<=0)carrito.splice(idx,1);
  renderCarrito();
}
function quitarItem(idx){carrito.splice(idx,1);renderCarrito();}
function vaciarCarrito(){if(carrito.length&&confirm('¿Vaciar carrito?')){carrito=[];renderCarrito();}}

function renderCarrito(){
  const cont=$('carritoCont');
  if(!carrito.length){
    cont.innerHTML='<div style="color:#9ca3af;text-align:center;padding:8px;font-size:13px">Carrito vacío — agrega con ＋ o escanea 📷</div>';
    $('carritoAcciones').style.display='none';
    return;
  }
  $('carritoAcciones').style.display='block';
  $('cartTotal').textContent=fmt(totalCarrito());
  cont.innerHTML=carrito.map((i,idx)=>`
    <div class="cart-item">
      <div style="flex:1;min-width:0">
        <div class="ci-nom">${esc(i.nombre)}</div>
        <div class="ci-precio">${fmt(i.precio)} c/u</div>
      </div>
      <div class="qty">
        <button onclick="cambiarQty(${idx},-1)">−</button>
        <span>${i.cantidad}</span>
        <button onclick="cambiarQty(${idx},1)">＋</button>
      </div>
      <div class="ci-total">${fmt(i.precio*i.cantidad)}</div>
      <button class="ci-del" onclick="quitarItem(${idx})">✕</button>
    </div>`).join('');
}

async function descontarStock(items){
  for(const it of items){
    const p=await dbGet('productos',it.productoId);
    if(p){p.stock=(p.stock||0)-it.cantidad;await dbPut('productos',p);}
  }
}

async function cobrarContado(){
  if(!carrito.length){toast('Primero agrega productos al carrito 🛒');return;}
  const total=totalCarrito();
  if(!confirm('¿Cobrar '+fmt(total)+' en efectivo?'))return;
  await dbPut('ventas',{tipo:'contado',items:carrito.map(i=>({...i})),total:total,fecha:Date.now()});
  await descontarStock(carrito);
  carrito=[];renderCarrito();renderVentaProductos();
  toast('✅ Venta cobrada: '+fmt(total));
}

/* ---------- Fiado: paso 1 (cliente) ---------- */
async function iniciarFiado(){
  if(!carrito.length){toast('Primero agrega productos al carrito 🛒');return;}
  $('fiadoTotal').textContent=fmt(totalCarrito());
  const deudas=await calcularDeudas();
  deudas.sort((a,b)=>a.cliente.nombre.localeCompare(b.cliente.nombre));
  $('listaClientesFiado').innerHTML=deudas.length?deudas.map(m=>`
    <div class="fila-cliente card" onclick="seleccionarClienteFiado(${m.cliente.id})">
      <div style="flex:1;min-width:0">
        <div class="p-nom">👤 ${esc(m.cliente.nombre)}</div>
        ${m.cliente.telefono?`<div class="p-meta">${esc(m.cliente.telefono)}</div>`:''}
      </div>
      ${m.deuda>0?`<div class="deuda" style="font-size:14px">${fmt(m.deuda)}</div>`:'<div style="color:#059669;font-size:13px">✓ al corriente</div>'}
    </div>`).join(''):'<div style="color:#9ca3af;text-align:center;padding:10px;font-size:13px">Aún no hay clientes. Crea el primero arriba 👆</div>';
  abrirModal('mClientes');
}

async function seleccionarClienteFiado(id){
  const c=await dbGet('clientes',id);
  if(!c)return;
  cerrarModal('mClientes');
  fiandoClienteId=id;
  $('condCliente').textContent=c.nombre;
  $('condTotal').textContent=fmt(totalCarrito());
  $('condAbono').value='';
  $('condNumPagos').value='2';
  $('condFrecuencia').value='';
  $('condFecha').value='';
  elegirPlan('uno');
  actualizarResumenCondiciones();
  abrirModal('mCondiciones');
}

async function crearClienteYFiar(){
  const nombre=$('nuevoClienteFiado').value.trim();
  if(!nombre){toast('Escribe el nombre');return;}
  const id=await dbPut('clientes',{nombre:nombre,telefono:$('nuevoClienteFiadoTel').value.trim()});
  $('nuevoClienteFiado').value='';$('nuevoClienteFiadoTel').value='';
  await seleccionarClienteFiado(id);
}

/* ---------- Fiado: paso 2 (condiciones) ---------- */
let fiandoClienteId=null, planElegido='uno';

function elegirPlan(p){
  planElegido=p;
  $('planUno').classList.toggle('plan-activo',p==='uno');
  $('planParcial').classList.toggle('plan-activo',p==='parcial');
  $('filaNumPagos').style.display=p==='parcial'?'block':'none';
  actualizarResumenCondiciones();
}
function cambiarNumPagos(d){
  const i=$('condNumPagos');
  i.value=Math.max(2,(parseInt(i.value)||2)+d);
  actualizarResumenCondiciones();
}
function setAbonoChip(v){
  if(v==='mitad'){
    $('condAbono').value=(totalCarrito()/2).toFixed(2);
  }else{
    $('condAbono').value=v;
  }
  actualizarResumenCondiciones();
}
function setFechaChip(dias){
  const d=new Date();d.setDate(d.getDate()+dias);
  $('condFecha').value=fechaLocal(d);
}
function frecuenciaCambio(){
  const f=$('condFrecuencia').value;
  if(f&&!$('condFecha').value){
    setFechaChip(f==='semanal'?7:f==='quincenal'?14:30);
  }
}
function actualizarResumenCondiciones(){
  const total=totalCarrito();
  const abono=Math.min(parseFloat($('condAbono').value)||0,total);
  const saldo=total-abono;
  $('condSaldo').textContent=fmt(saldo);
  if(planElegido==='parcial'){
    const n=Math.max(2,parseInt($('condNumPagos').value)||2);
    $('condPorPago').textContent='≈ '+fmt(saldo/n)+' cada pago';
  }
}

async function registrarFiado(){
  const c=await dbGet('clientes',fiandoClienteId);
  if(!c)return;
  const total=totalCarrito();
  let abonoInicial=parseFloat($('condAbono').value)||0;
  if(abonoInicial<0)abonoInicial=0;
  if(abonoInicial>total){toast('El abono inicial no puede ser mayor al total');return;}
  const saldo=total-abonoInicial;
  const plan=planElegido;
  const numPagos=plan==='parcial'?Math.max(2,parseInt($('condNumPagos').value)||2):null;
  const frecuencia=$('condFrecuencia').value||null;
  let proximaFecha=null;
  if($('condFecha').value){
    proximaFecha=new Date($('condFecha').value+'T12:00:00').getTime();
  }else if(frecuencia){
    const dias=frecuencia==='semanal'?7:frecuencia==='quincenal'?14:30;
    const d=new Date();d.setDate(d.getDate()+dias);d.setHours(12,0,0,0);
    proximaFecha=d.getTime();
  }
  await dbPut('ventas',{tipo:'fiado',clienteId:c.id,clienteNombre:c.nombre,items:carrito.map(i=>({...i})),total:total,abonoInicial:abonoInicial,saldo:saldo,plan:plan,numPagos:numPagos,frecuencia:frecuencia,proximaFecha:proximaFecha,fecha:Date.now()});
  if(abonoInicial>0)await dbPut('abonos',{clienteId:c.id,monto:abonoInicial,fecha:Date.now(),nota:'Abono inicial'});
  await descontarStock(carrito);
  carrito=[];renderCarrito();renderVentaProductos();
  cerrarModal('mCondiciones');
  toast(saldo>0?('📓 Fiado a '+c.nombre+' · quedó debiendo '+fmt(saldo)):('✅ '+c.nombre+' pagó todo, quedó al corriente'));
}

/* ================= Lista de productos ================= */
async function renderVentaProductos(){
  const q=($('buscarVenta').value||'').trim().toLowerCase();
  let prods=await dbGetAll('productos');
  if(q)prods=prods.filter(p=>(p.nombre||'').toLowerCase().includes(q)||(p.codigo||'').toLowerCase().includes(q));
  prods.sort((a,b)=>(a.nombre||'').localeCompare(b.nombre||''));
  const cont=$('listaVentaProductos');
  if(!prods.length){
    cont.innerHTML='<div class="card" style="text-align:center;color:#9ca3af;font-size:13px">No hay productos todavía.<br><br><button class="btn btn-primary" onclick="nuevoProducto()">＋ Crear mi primer producto</button></div>';
    return;
  }
  cont.innerHTML=prods.map(p=>{
    const c=catInfo(p.categoria),stock=p.stock||0;
    return `<div class="card fila-prod">
      <div style="flex:1;min-width:0">
        <div class="p-nom">${c.emoji} ${esc(p.nombre)}</div>
        <div class="p-meta"><span class="chip" style="background:${c.color}18;color:${c.color}">${c.nombre}</span> &nbsp;<span class="stock ${stock<=0?'rojo':stock<=3?'naranja':'verde'}">Stock: ${stock}</span></div>
        <div class="p-precio">${fmt(p.precio)}</div>
      </div>
      <button class="btn-add" onclick="agregarCarrito(${p.id})">＋</button>
    </div>`;
  }).join('');
}

/* ================= Productos: alta / edición ================= */
let editandoProductoId=null;
function nuevoProducto(codigo){
  editandoProductoId=null;
  $('prodTitulo').textContent='Nuevo producto';
  $('fCodigo').value=codigo||'';
  $('fNombre').value='';$('fCategoria').value='ilusion';
  $('fPrecio').value='';$('fCosto').value='';$('fStock').value='1';
  $('btnEliminarProducto').style.display='none';
  abrirModal('mProducto');
}
async function editarProducto(id){
  const p=await dbGet('productos',id);
  if(!p)return;
  editandoProductoId=id;
  $('prodTitulo').textContent='Editar producto';
  $('fCodigo').value=p.codigo||'';$('fNombre').value=p.nombre||'';
  $('fCategoria').value=p.categoria||'otros';
  $('fPrecio').value=p.precio!=null?p.precio:'';
  $('fCosto').value=p.costo!=null?p.costo:'';
  $('fStock').value=p.stock!=null?p.stock:0;
  $('btnEliminarProducto').style.display='block';
  abrirModal('mProducto');
}
function ajustarStock(d){const i=$('fStock');i.value=Math.max((parseInt(i.value)||0)+d,0);}
async function guardarProducto(){
  const nombre=$('fNombre').value.trim();
  const precio=parseFloat($('fPrecio').value);
  if(!nombre){toast('Escribe el nombre');return;}
  if(!(precio>0)){toast('Precio inválido');return;}
  const obj={codigo:$('fCodigo').value.trim(),nombre:nombre,categoria:$('fCategoria').value,precio:precio,costo:parseFloat($('fCosto').value)||0,stock:parseInt($('fStock').value)||0};
  if(obj.codigo){
    const existe=await buscarPorCodigo(obj.codigo);
    if(existe&&existe.id!==editandoProductoId&&!confirm('Ya existe "'+existe.nombre+'" con ese código. ¿Guardar de todos modos?'))return;
  }
  if(editandoProductoId)obj.id=editandoProductoId;
  await dbPut('productos',obj);
  cerrarModal('mProducto');
  toast('✅ Producto guardado');
  renderProductos();renderVentaProductos();
}
async function eliminarProducto(){
  if(!editandoProductoId)return;
  if(!confirm('¿Eliminar este producto? Las ventas pasadas no se borran.'))return;
  await dbDel('productos',editandoProductoId);
  cerrarModal('mProducto');
  toast('Producto eliminado');
  renderProductos();renderVentaProductos();
}
async function renderProductos(){
  const q=($('buscarProducto').value||'').trim().toLowerCase();
  let prods=await dbGetAll('productos');
  if(q)prods=prods.filter(p=>(p.nombre||'').toLowerCase().includes(q)||(p.codigo||'').toLowerCase().includes(q));
  prods.sort((a,b)=>(a.nombre||'').localeCompare(b.nombre||''));
  $('numProductos').textContent=prods.length+' producto(s)';
  const cont=$('listaProductos');
  if(!prods.length){cont.innerHTML='<div class="card" style="text-align:center;color:#9ca3af;font-size:13px">Sin productos. Da de alta el primero con el botón ＋ Nuevo o escaneando 📷</div>';return;}
  cont.innerHTML=prods.map(p=>{
    const c=catInfo(p.categoria),stock=p.stock||0;
    return `<div class="card fila-prod" onclick="editarProducto(${p.id})">
      <div style="flex:1;min-width:0">
        <div class="p-nom">${c.emoji} ${esc(p.nombre)}</div>
        <div class="p-meta"><span class="chip" style="background:${c.color}18;color:${c.color}">${c.nombre}</span>${p.codigo?' · '+esc(p.codigo):''}</div>
        <div class="p-meta">Venta: <b>${fmt(p.precio)}</b>${p.costo?' · Costo: '+fmt(p.costo):''}</div>
      </div>
      <div class="stock-badge ${stock<=0?'rojo':stock<=3?'naranja':'verde'}">${stock}<span style="font-size:9px;display:block;font-weight:600">piezas</span></div>
    </div>`;
  }).join('');
}

/* ================= Fiados / clientes ================= */
async function calcularDeudas(){
  const [ventas,clientes,abonos]=await Promise.all([dbGetAll('ventas'),dbGetAll('clientes'),dbGetAll('abonos')]);
  const map={};
  clientes.forEach(c=>map[c.id]={cliente:c,deuda:0,fiados:0,ultimo:null,plan:null,numPagos:null,frecuencia:null,proximaFecha:null,_fechaUlt:0});
  ventas.filter(v=>v.tipo==='fiado').forEach(v=>{
    if(!map[v.clienteId])map[v.clienteId]={cliente:{id:v.clienteId,nombre:v.clienteNombre||('Cliente '+v.clienteId)},deuda:0,fiados:0,ultimo:null,plan:null,numPagos:null,frecuencia:null,proximaFecha:null,_fechaUlt:0};
    const m=map[v.clienteId];
    m.deuda+=v.total;m.fiados++;
    m.ultimo=Math.max(m.ultimo||0,v.fecha);
    if(v.fecha>=m._fechaUlt){
      m._fechaUlt=v.fecha;
      m.plan=v.plan||null;m.numPagos=v.numPagos||null;
      m.frecuencia=v.frecuencia||null;m.proximaFecha=v.proximaFecha||null;
    }
  });
  abonos.forEach(a=>{if(map[a.clienteId])map[a.clienteId].deuda-=a.monto;});
  return Object.values(map);
}

async function renderFiados(){
  const lista=await calcularDeudas();
  const hoy=inicioDia(Date.now());
  const conDeuda=lista.filter(m=>m.deuda>0.009).sort((a,b)=>b.deuda-a.deuda);
  const alCorriente=lista.filter(m=>m.deuda<=0.009).sort((a,b)=>a.cliente.nombre.localeCompare(b.cliente.nombre));
  $('totalPorCobrar').textContent=fmt(conDeuda.reduce((s,m)=>s+m.deuda,0));
  let html='';
  if(!lista.length)html+='<div class="card" style="text-align:center;color:#9ca3af;font-size:13px">No hay clientes todavía.<br>Se crean automáticamente al hacer tu primera venta fiada.</div>';
  conDeuda.forEach(m=>{
    let planTxt='';
    if(m.plan==='parcial'&&m.numPagos)planTxt='En '+m.numPagos+' partes'+(m.frecuencia?' · '+FREQ_TXT[m.frecuencia].toLowerCase():'');
    else if(m.plan==='uno')planTxt='1 solo pago'+(m.frecuencia?' · '+FREQ_TXT[m.frecuencia].toLowerCase():'');
    let proxTxt='';
    if(m.proximaFecha){
      if(m.proximaFecha<hoy)proxTxt=`<div class="p-meta" style="color:#dc2626;font-weight:700">⚠️ Pago atrasado (era el ${fmtF(m.proximaFecha)})</div>`;
      else if(m.proximaFecha===hoy)proxTxt='<div class="p-meta" style="color:#d97706;font-weight:700">📅 Paga hoy</div>';
      else proxTxt=`<div class="p-meta">📅 Próximo pago: ${fmtF(m.proximaFecha)}</div>`;
    }
    html+=`<div class="card fila-cliente" onclick="detalleCliente(${m.cliente.id})">
      <div style="flex:1;min-width:0">
        <div class="p-nom">👤 ${esc(m.cliente.nombre)}</div>
        <div class="p-meta">${m.fiados} fiado(s) · último: ${m.ultimo?fmtF(m.ultimo):'—'}${planTxt?' · '+planTxt:''}</div>
        ${proxTxt}
      </div>
      <div class="deuda">${fmt(m.deuda)}</div>
    </div>`;
  });
  if(alCorriente.length){
    html+='<h3 style="margin:14px 4px 8px;color:#6b7280;font-size:13px">Clientes al corriente</h3>';
    alCorriente.forEach(m=>{
      html+=`<div class="card fila-cliente" onclick="detalleCliente(${m.cliente.id})">
        <div style="flex:1;min-width:0"><div class="p-nom">👤 ${esc(m.cliente.nombre)}</div></div>
        <div style="color:#059669;font-weight:700;font-size:13px">${m.deuda<-0.009?'Saldo a favor '+fmt(-m.deuda):'Al corriente ✓'}</div>
      </div>`;
    });
  }
  $('listaFiados').innerHTML=html;
}

let detalleClienteId=null;
async function detalleCliente(id){
  detalleClienteId=id;
  const [cliente,ventas,abonos]=await Promise.all([dbGet('clientes',id),dbGetAll('ventas'),dbGetAll('abonos')]);
  if(!cliente)return;
  const fiados=ventas.filter(v=>v.tipo==='fiado'&&v.clienteId===id);
  const abs=abonos.filter(a=>a.clienteId===id);
  const deuda=fiados.reduce((s,v)=>s+v.total,0)-abs.reduce((s,a)=>s+a.monto,0);
  $('dcNombre').textContent=cliente.nombre;
  $('dcTel').textContent=cliente.telefono?('📞 '+cliente.telefono):'';
  $('dcDeuda').textContent=fmt(deuda);
  $('dcDeuda').style.color=deuda>0?'#dc2626':'#059669';

  /* Plan de pago del fiado más reciente */
  const planDiv=$('dcPlan');
  const fiadoConPlan=fiados.filter(f=>f.plan).sort((a,b)=>b.fecha-a.fecha)[0];
  if(fiadoConPlan&&deuda>0){
    const hoy=inicioDia(Date.now());
    let txt='📋 <b>Plan de pago:</b> '+(fiadoConPlan.plan==='uno'?'1 solo pago':'En '+fiadoConPlan.numPagos+' partes');
    if(fiadoConPlan.frecuencia)txt+=' · '+FREQ_TXT[fiadoConPlan.frecuencia];
    if(fiadoConPlan.proximaFecha){
      const pf=fiadoConPlan.proximaFecha;
      if(pf<hoy)txt+='<br><b style="color:#dc2626">⚠️ Pago atrasado (era el '+fmtF(pf)+')</b>';
      else if(pf===hoy)txt+='<br><b style="color:#d97706">📅 Paga hoy</b>';
      else txt+='<br>📅 Próximo pago: <b>'+fmtF(pf)+'</b>';
    }
    planDiv.innerHTML=txt;planDiv.style.display='block';
  }else planDiv.style.display='none';

  const movs=[
    ...fiados.map(v=>({tipo:'fiado',fecha:v.fecha,monto:v.total,id:v.id,det:v.items.map(i=>i.cantidad+'× '+i.nombre).join(', ')+(v.abonoInicial?' · abono inicial '+fmt(v.abonoInicial):'')})),
    ...abs.map(a=>({tipo:'abono',fecha:a.fecha,monto:a.monto,id:a.id,det:a.nota||'Abono en efectivo'}))
  ].sort((a,b)=>b.fecha-a.fecha);
  $('dcMovs').innerHTML=movs.length?movs.map(m=>`
    <div class="mov">
      <div style="flex:1;min-width:0">
        <div class="mov-t">${m.tipo==='fiado'?'📓 Fiado':'💰 Abono'} <span class="mov-f">${fmtF(m.fecha)}</span></div>
        <div class="mov-d">${esc(m.det)}</div>
      </div>
      <div class="mov-m" style="color:${m.tipo==='fiado'?'#dc2626':'#059669'}">${m.tipo==='fiado'?'+':'−'}${fmt(m.monto)}</div>
      <button class="ci-del" onclick="eliminarMov('${m.tipo}',${m.id},${id})">🗑</button>
    </div>`).join(''):'<div style="color:#9ca3af;text-align:center;padding:10px;font-size:13px">Sin movimientos</div>';
  $('btnAbonar').onclick=()=>abrirAbono(id,deuda);
  const wa=$('btnWhatsApp');
  if(cliente.telefono&&deuda>0){wa.style.display='block';wa.onclick=()=>recordarWhatsApp(cliente,deuda);}
  else wa.style.display='none';
  abrirModal('mClienteDetalle');
}

async function eliminarMov(tipo,id,clienteId){
  if(!confirm('¿Eliminar este movimiento? Cambiará los totales.'))return;
  if(tipo==='fiado')await dbDel('ventas',id);else await dbDel('abonos',id);
  toast('Movimiento eliminado');
  await detalleCliente(clienteId);
  renderFiados();
}

async function eliminarCliente(){
  const id=detalleClienteId;
  if(!confirm('¿Eliminar al cliente junto con todos sus fiados y abonos?'))return;
  const [ventas,abonos]=await Promise.all([dbGetAll('ventas'),dbGetAll('abonos')]);
  for(const v of ventas.filter(v=>v.clienteId===id))await dbDel('ventas',v.id);
  for(const a of abonos.filter(a=>a.clienteId===id))await dbDel('abonos',a.id);
  await dbDel('clientes',id);
  cerrarModal('mClienteDetalle');
  toast('Cliente eliminado');
  renderFiados();
}

let abonoClienteId=null;
function abrirAbono(id,deuda){
  abonoClienteId=id;
  $('abonoMonto').value=deuda>0?deuda.toFixed(2):'';
  abrirModal('mAbono');
}
async function guardarAbono(){
  const monto=parseFloat($('abonoMonto').value);
  if(!monto||monto<=0){toast('Monto inválido');return;}
  await dbPut('abonos',{clienteId:abonoClienteId,monto:monto,fecha:Date.now()});
  cerrarModal('mAbono');
  toast('💰 Abono registrado: '+fmt(monto));
  await detalleCliente(abonoClienteId);
  renderFiados();
}

function recordarWhatsApp(c,deuda){
  let tel=(c.telefono||'').replace(/\D/g,'');
  if(tel.length===10)tel='52'+tel;
  const msg='Hola '+c.nombre+' 👋, le saluda Leonides. Le recuerdo amablemente su cuenta pendiente: '+fmt(deuda)+'. ¡Muchas gracias! 🌸';
  window.open('https://wa.me/'+tel+'?text='+encodeURIComponent(msg),'_blank');
}

function abrirModalClienteNuevo(){$('ncNombre').value='';$('ncTel').value='';abrirModal('mClienteNuevo');}
async function guardarClienteNuevo(){
  const nombre=$('ncNombre').value.trim();
  if(!nombre){toast('Escribe el nombre');return;}
  await dbPut('clientes',{nombre:nombre,telefono:$('ncTel').value.trim()});
  cerrarModal('mClienteNuevo');
  toast('✅ Cliente guardado');
  renderFiados();
}

/* ================= Dashboard ================= */
async function renderDashboard(){
  const [ventas,abonos,productos]=await Promise.all([dbGetAll('ventas'),dbGetAll('abonos'),dbGetAll('productos')]);
  const hoy=inicioDia(Date.now());
  const vHoy=ventas.filter(v=>v.fecha>=hoy);
  const totalVHoy=vHoy.reduce((s,v)=>s+v.total,0);
  const contadoHoy=vHoy.filter(v=>v.tipo==='contado').reduce((s,v)=>s+v.total,0);
  const aHoy=abonos.filter(a=>a.fecha>=hoy).reduce((s,a)=>s+a.monto,0);
  $('stIngresos').textContent=fmt(contadoHoy+aHoy);
  $('stIngresosDet').textContent='Efectivo '+fmt(contadoHoy)+' + abonos '+fmt(aHoy);
  $('stVentasHoy').textContent=fmt(totalVHoy);
  $('stVentasHoyDet').textContent=vHoy.length+' venta(s)';
  const porCobrar=ventas.filter(v=>v.tipo==='fiado').reduce((s,v)=>s+v.total,0)-abonos.reduce((s,a)=>s+a.monto,0);
  const deudores=(await calcularDeudas()).filter(m=>m.deuda>0.009).length;
  $('stPorCobrar').textContent=fmt(Math.max(porCobrar,0));
  $('stPorCobrarDet').textContent=deudores+' cliente(s) deben';
  const unidades=productos.reduce((s,p)=>s+Math.max(p.stock||0,0),0);
  const valor=productos.reduce((s,p)=>s+(p.precio||0)*Math.max(p.stock||0,0),0);
  $('stInventario').textContent=fmt(valor);
  $('stInventarioDet').textContent=unidades+' piezas · '+productos.length+' productos';

  const dias=[];
  for(let i=6;i>=0;i--){
    const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-i);
    const ini=d.getTime(),fin=ini+86400000;
    const total=ventas.filter(v=>v.fecha>=ini&&v.fecha<fin).reduce((s,v)=>s+v.total,0);
    dias.push({total:total,label:new Intl.DateTimeFormat('es-MX',{weekday:'short'}).format(d)});
  }
  const max=Math.max.apply(null,dias.map(d=>d.total).concat([1]));
  $('chart').innerHTML=dias.map(d=>`
    <div class="bar-col">
      <div class="bar-val">${d.total?fmtCorto(d.total):''}</div>
      <div class="bar-wrap"><div class="bar" style="height:${Math.max(Math.round(d.total/max*100),d.total?4:2)}%"></div></div>
      <div class="bar-day">${d.label}</div>
    </div>`).join('');

  const iniMes=new Date();iniMes.setDate(1);iniMes.setHours(0,0,0,0);
  const catTotals={};CATS.forEach(c=>catTotals[c.id]=0);
  ventas.filter(v=>v.fecha>=iniMes.getTime()).forEach(v=>{
    (v.items||[]).forEach(i=>{
      const cat=CATS.some(c=>c.id===i.categoria)?i.categoria:'otros';
      catTotals[cat]=(catTotals[cat]||0)+i.precio*i.cantidad;
    });
  });
  const mesTotal=Object.values(catTotals).reduce((a,b)=>a+b,0);
  $('catVentas').innerHTML=mesTotal?CATS.filter(c=>catTotals[c.id]>0).map(c=>{
    const t=catTotals[c.id],pct=Math.round(t/mesTotal*100);
    return `<div class="cat-row">
      <div class="cat-top"><span>${c.emoji} ${c.nombre}</span><b>${fmt(t)} <span style="color:#9ca3af;font-weight:400">(${pct}%)</span></b></div>
      <div class="cat-bar-bg"><div class="cat-bar" style="width:${pct}%;background:${c.color}"></div></div>
    </div>`;
  }).join(''):'<div style="color:#9ca3af;font-size:13px">Sin ventas este mes</div>';

  const bajos=productos.filter(p=>(p.stock||0)<=3).sort((a,b)=>(a.stock||0)-(b.stock||0));
  $('stockBajo').innerHTML=bajos.length?bajos.slice(0,12).map(p=>{
    const c=catInfo(p.categoria);
    return `<div class="bajo-row"><span>${c.emoji} ${esc(p.nombre)}</span><b class="${(p.stock||0)<=0?'rojo':'naranja'}">${p.stock||0} pz</b></div>`;
  }).join(''):'<div style="color:#9ca3af;font-size:13px">Todo bien surtido ✓</div>';
}

/* ================= Exportar / Importar ================= */
async function exportar(){
  try{
    const data={_app:'Leonides POS',_version:1,_fecha:new Date().toISOString(),
      productos:await dbGetAll('productos'),ventas:await dbGetAll('ventas'),
      clientes:await dbGetAll('clientes'),abonos:await dbGetAll('abonos')};
    const nombre='leonides_pos_respaldo_'+new Date().toISOString().slice(0,10)+'.json';
    const file=new File([JSON.stringify(data,null,2)],nombre,{type:'application/json'});
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      try{await navigator.share({files:[file],title:'Respaldo Leonides POS'});toast('✅ Respaldo compartido');return;}
      catch(e){if(e.name==='AbortError')return;}
    }
    const url=URL.createObjectURL(file);
    const a=document.createElement('a');
    a.href=url;a.download=nombre;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
    toast('⬇️ Respaldo descargado');
  }catch(e){toast('Error al exportar: '+e.message);}
}

async function importar(input){
  const file=input.files[0];input.value='';
  if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(!data||(!Array.isArray(data.productos)&&!Array.isArray(data.ventas))){toast('El archivo no es un respaldo válido');return;}
    const nP=(data.productos||[]).length,nV=(data.ventas||[]).length,nC=(data.clientes||[]).length,nA=(data.abonos||[]).length;
    if(!confirm('El respaldo contiene:\n'+nP+' productos, '+nV+' ventas, '+nC+' clientes, '+nA+' abonos.\n\nEsto REEMPLAZARÁ los datos actuales. ¿Continuar?'))return;
    for(const s of stores)await dbClear(s);
    for(const p of data.productos||[])await dbPut('productos',p);
    for(const v of data.ventas||[])await dbPut('ventas',v);
    for(const c of data.clientes||[])await dbPut('clientes',c);
    for(const a of data.abonos||[])await dbPut('abonos',a);
    carrito=[];
    toast('✅ Datos importados');
    renderTodo();
  }catch(e){toast('Error al importar: '+e.message);}
}

async function borrarTodo(){
  if(!confirm('⚠️ ¿Borrar TODOS los datos? Mejor exporta un respaldo primero. Esta acción no se puede deshacer.'))return;
  if(!confirm('¿De verdad? Se borrará todo permanentemente.'))return;
  for(const s of stores)await dbClear(s);
  carrito=[];renderTodo();
  toast('Datos borrados');
}

async function cargarEjemplo(){
  const prods=await dbGetAll('productos');
  if(prods.length&&!confirm('Ya hay productos. ¿Agregar los de ejemplo de todos modos?'))return;
  const ejemplos=[
    {codigo:'7501000000015',nombre:'Conjunto encaje rosa Ilusión',categoria:'ilusion',precio:350,costo:200,stock:5},
    {codigo:'7501000000022',nombre:'Brasier varilla Ilusión 34B',categoria:'ilusion',precio:180,costo:95,stock:8},
    {codigo:'7501000000039',nombre:'Panty encaje Ilusión',categoria:'ilusion',precio:60,costo:28,stock:20},
    {codigo:'7501000000046',nombre:'Fraiche inspiración floral 50 ml',categoria:'fraiche',precio:250,costo:140,stock:6},
    {codigo:'7501000000053',nombre:'Fraiche lavanda 30 ml',categoria:'fraiche',precio:180,costo:100,stock:4},
    {codigo:'7501000000060',nombre:'Labial mate rojo',categoria:'cosmeticos',precio:95,costo:45,stock:10},
    {codigo:'7501000000077',nombre:'Rímel volumen',categoria:'cosmeticos',precio:120,costo:60,stock:3},
    {codigo:'7501000000084',nombre:'Base líquida tono 2',categoria:'cosmeticos',precio:150,costo:80,stock:2}
  ];
  for(const p of ejemplos)await dbPut('productos',p);
  toast('🎨 Datos de ejemplo cargados');
  renderTodo();
}

/* ================= Varios ================= */
async function renderStats(){
  const [p,v,c,a]=await Promise.all(stores.map(s=>dbGetAll(s)));
  $('stats').innerHTML=
    '<div class="stat-row"><span>📦 Productos</span><b>'+p.length+'</b></div>'+
    '<div class="stat-row"><span>🧾 Ventas</span><b>'+v.length+'</b></div>'+
    '<div class="stat-row"><span>👥 Clientes</span><b>'+c.length+'</b></div>'+
    '<div class="stat-row"><span>💰 Abonos</span><b>'+a.length+'</b></div>'+
    '<div class="stat-row" style="border-bottom:0"><span>💽 Guardado en</span><b style="font-size:12px">'+(usarLocalStorage?'localStorage':'IndexedDB')+'</b></div>';
  $('infoScanner').textContent='BarcodeDetector' in window
    ?'✅ Tu navegador sí soporta escaneo de códigos con la cámara.'
    :'⚠️ Este navegador no soporta escaneo automático de códigos. Usa la captura manual del código (escribir los números).';
}

function renderTodo(){
  renderCarrito();
  const activa=document.querySelector('.tab.active');
  mostrarVista(activa?activa.dataset.v:'ventas');
}

(async function init(){
  try{
    if(!window.indexedDB)throw new Error('IndexedDB no existe en este navegador');
    db=await abrirDB();
    await req(st('productos').getAll());
  }catch(e){
    db=null;usarLocalStorage=true;cargarLS();
    toast('⚠️ IndexedDB no disponible aquí; los datos se guardarán en localStorage',3800);
  }
  const f=new Date().toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long'});
  $('hdrFecha').textContent=f.charAt(0).toUpperCase()+f.slice(1);
  $('buscarVenta').addEventListener('input',renderVentaProductos);
  $('buscarProducto').addEventListener('input',renderProductos);
  renderCarrito();
  mostrarVista('ventas');
})();
