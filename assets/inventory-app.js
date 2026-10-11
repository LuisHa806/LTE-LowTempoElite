(() => {
  const el=id=>document.getElementById(id), config=window.LTE_INVENTORY_CONFIG||{}, message=el('message');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=v=>new Intl.NumberFormat('de-DE').format(v);
  const date=v=>new Intl.DateTimeFormat('de-DE',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v));
  let db, user, admin=false;
  const show=(id,on=true)=>el(id).classList.toggle('hidden',!on);
  function notify(text,type=''){message.textContent=text;message.className=`status ${type}`;message.classList.remove('hidden');message.scrollIntoView({behavior:'smooth',block:'nearest'});}
  function fail(error){notify(error?.message||'Die Buchung konnte nicht gespeichert werden.','error');}
  async function rpc(name,args){const {data,error}=await db.rpc(name,args);if(error)throw error;return data;}
  if(!config.supabaseUrl||!config.publishableKey){show('setup');return;}
  if(!window.supabase?.createClient){show('setup');notify('Die Anmeldesoftware konnte nicht geladen werden.','error');return;}
  db=window.supabase.createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});

  async function load(){
    const [itemsRes,movesRes]=await Promise.all([
      db.from('lte_inventory_items').select('id,name,category,quantity_on_hand,updated_at').order('name'),
      db.from('lte_inventory_movements').select('id,item_id,direction,quantity,quantity_after,player_name,note,created_at').order('created_at',{ascending:false}).limit(100)
    ]);
    if(itemsRes.error)throw itemsRes.error;if(movesRes.error)throw movesRes.error;
    const items=itemsRes.data||[], movements=movesRes.data||[], names=Object.fromEntries(items.map(x=>[x.id,x.name]));
    el('item-count').textContent=number(items.length);
    el('stock-total').textContent=number(items.reduce((sum,x)=>sum+x.quantity_on_hand,0));
    el('movement-count').textContent=number(movements.length);
    el('inventory').innerHTML=items.length?`<table><thead><tr><th>Item</th><th>Kategorie</th><th>Verfügbar</th><th>Zuletzt aktualisiert</th></tr></thead><tbody>${items.map(i=>`<tr><td>${esc(i.name)}</td><td>${esc(i.category||'–')}</td><td class="qty">${number(i.quantity_on_hand)}</td><td>${date(i.updated_at)}</td></tr>`).join('')}</tbody></table>`:'Noch keine Items angelegt.';
    el('item').innerHTML=`<option value="">Item auswählen</option>${items.map(i=>`<option value="${i.id}">${esc(i.name)} · Bestand ${number(i.quantity_on_hand)}</option>`).join('')}`;
    el('history').innerHTML=movements.length?`<table><thead><tr><th>Zeitpunkt</th><th>Bewegung</th><th>Item</th><th>Menge</th><th>Bestand danach</th><th>Spieler</th><th>Notiz</th></tr></thead><tbody>${movements.map(m=>`<tr><td>${date(m.created_at)}</td><td class="${m.direction==='in'?'in':'out'}">${m.direction==='in'?'Eingang':'Ausgang'}</td><td>${esc(names[m.item_id]||'Item')}</td><td>${m.direction==='in'?'+':'−'}${number(m.quantity)}</td><td>${number(m.quantity_after)}</td><td>${esc(m.player_name||'–')}</td><td>${esc(m.note)}</td></tr>`).join('')}</tbody></table>`:'Noch keine Lagerbewegungen.';
  }
  async function enter(sessionUser){
    user=sessionUser;show('signed-out',false);show('setup',false);el('auth-id').textContent=user.id;
    const {data,error}=await db.rpc('is_lte_inventory_admin');if(error)throw error;admin=data===true;
    show('not-admin',!admin);show('dashboard',admin);
    if(admin){el('discord-user').textContent=user.user_metadata?.global_name||user.user_metadata?.full_name||user.user_metadata?.name||user.id;await load();}
  }
  el('login').addEventListener('click',async()=>{const {error}=await db.auth.signInWithOAuth({provider:'discord',options:{redirectTo:location.href.split('#')[0]}});if(error)fail(error);});
  document.querySelectorAll('.logout').forEach(b=>b.addEventListener('click',async()=>{const {error}=await db.auth.signOut();if(error)fail(error);}));
  el('movement-form').addEventListener('submit',async event=>{
    event.preventDefault();const p_item_id=Number(el('item').value),p_direction=el('direction').value,p_quantity=Number(el('quantity').value),p_player_name=el('player').value.trim()||null,p_note=el('note').value.trim();
    if(!p_item_id||!Number.isSafeInteger(p_quantity)||p_quantity<=0)return notify('Bitte Item und eine gültige Stückzahl wählen.','error');
    try{await rpc('admin_record_inventory_movement',{p_item_id,p_direction,p_quantity,p_player_name,p_note});event.target.reset();notify(p_direction==='in'?'Einlagerung verbucht.':'Ausgabe verbucht.','ok');await load();}catch(error){fail(error);}
  });
  el('new-item-form').addEventListener('submit',async event=>{
    event.preventDefault();const p_name=el('new-name').value.trim(),p_category=el('category').value.trim()||'Sonstiges',p_opening_quantity=Number(el('opening').value);
    if(!Number.isSafeInteger(p_opening_quantity)||p_opening_quantity<0)return notify('Bitte einen gültigen Anfangsbestand eingeben.','error');
    try{await rpc('admin_create_inventory_item',{p_name,p_category,p_opening_quantity});event.target.reset();el('opening').value='0';notify('Item angelegt und Anfangsbestand gespeichert.','ok');await load();}catch(error){fail(error);}
  });
  db.auth.onAuthStateChange((_event,session)=>{if(session?.user)setTimeout(()=>enter(session.user).catch(fail),0);else{user=null;admin=false;show('dashboard',false);show('not-admin',false);show('signed-out');}});
  db.auth.getSession().then(({data,error})=>{if(error)fail(error);else if(data.session?.user)enter(data.session.user).catch(fail);else show('signed-out');});
})();
