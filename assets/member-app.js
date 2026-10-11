(() => {
  const byId = (id) => document.getElementById(id);
  const setup = window.LTE_MEMBER_CONFIG || {};
  const message = byId('message');
  const currency = (amount) => `${new Intl.NumberFormat('de-DE').format(amount)} Spielgeld`;
  const date = (value) => new Intl.DateTimeFormat('de-DE', {dateStyle:'medium'}).format(new Date(value));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let client;
  let currentUser;
  let profile;
  let isAdmin = false;

  function notify(text, type = '') {
    message.textContent = text;
    message.className = `status ${type}`;
    message.classList.remove('hidden');
    message.scrollIntoView({behavior:'smooth', block:'nearest'});
  }
  function hideMessage() { message.classList.add('hidden'); }
  function show(id, visible = true) { byId(id).classList.toggle('hidden', !visible); }
  function fail(error) { notify(error?.message || 'Das hat leider nicht geklappt. Bitte versuche es erneut.', 'error'); }
  async function rpc(name, args) {
    const {data, error} = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }

  if (!setup.supabaseUrl || !setup.publishableKey) {
    show('setup-card');
    return;
  }
  if (!window.supabase?.createClient) {
    show('setup-card');
    notify('Die Anmeldesoftware konnte nicht geladen werden. Bitte lade die Seite neu.', 'error');
    return;
  }

  client = window.supabase.createClient(setup.supabaseUrl, setup.publishableKey, {
    auth: {persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}
  });

  async function enter(user) {
    currentUser = user;
    isAdmin = false;
    hideMessage();
    show('signed-out', false);
    show('setup-card', false);
    show('signed-in');
    show('user-id', false);
    byId('user-id').textContent = user.id;
    byId('account-uuid').textContent = user.id;
    const label = user.user_metadata?.full_name || user.user_metadata?.name || user.user_metadata?.global_name || 'Mitglied';
    byId('greeting').textContent = `Hallo, ${label}.`;

    const {data, error} = await client.from('member_profiles').select('user_id,minecraft_name,status,created_at').eq('user_id', user.id).maybeSingle();
    if (error) { fail(error); return; }
    profile = data;
    show('profile-form-card', !profile);
    show('pending-card', profile?.status === 'pending');
    show('rejected-card', profile?.status === 'rejected');
    show('member-dashboard', profile?.status === 'approved');

    const {data:admin, error:adminError} = await client.rpc('is_lte_admin');
    if (adminError) { fail(adminError); return; }
    isAdmin = admin === true;
    show('admin-panel', isAdmin);
    if (profile?.status === 'approved') await loadMemberDashboard();
    if (isAdmin) await loadAdminPanel();
  }

  async function loadMemberDashboard() {
    const [walletRes, txRes, planRes, subscriptionRes, itemRes, loanRes] = await Promise.all([
      client.from('wallet_accounts').select('balance').eq('member_id', currentUser.id).maybeSingle(),
      client.from('wallet_transactions').select('amount,reason,created_at').eq('member_id', currentUser.id).order('created_at',{ascending:false}).limit(20),
      client.from('subscription_plans').select('id,title,duration_days,price').eq('active',true).order('duration_days'),
      client.from('member_subscriptions').select('id,plan_id,starts_at,ends_at').eq('member_id',currentUser.id).order('ends_at',{ascending:false}),
      client.from('inventory_items').select('id,name,description,available_quantity').order('name'),
      client.from('item_loans').select('id,item_id,quantity,borrowed_at,due_at,returned_at').eq('member_id',currentUser.id).order('borrowed_at',{ascending:false})
    ]);
    for (const result of [walletRes,txRes,planRes,subscriptionRes,itemRes,loanRes]) if (result.error) throw result.error;

    byId('balance').textContent = currency(walletRes.data?.balance || 0);
    const now = Date.now();
    const active = (subscriptionRes.data || []).filter(s => new Date(s.starts_at).getTime() <= now && new Date(s.ends_at).getTime() > now).sort((a,b)=>new Date(b.ends_at)-new Date(a.ends_at))[0];
    byId('subscription-until').textContent = active ? date(active.ends_at) : 'Kein Abo';
    const open = (loanRes.data || []).filter(x => !x.returned_at);
    byId('open-loans').textContent = String(open.length);

    byId('plans').innerHTML = (planRes.data || []).map(p => `<article class="tile"><h3>${esc(p.title)}</h3><p>Laufzeit: ${p.duration_days} Tage</p><div class="price">${p.price ? currency(p.price) : 'Preis folgt'}</div><button class="button purchase-plan" data-plan="${esc(p.id)}" ${p.price ? '' : 'disabled'}>Abo kaufen</button></article>`).join('') || '<p class="muted">Aktuell gibt es keine Abos.</p>';
    document.querySelectorAll('.purchase-plan').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try { await rpc('purchase_subscription',{p_plan_id:button.dataset.plan}); notify('Abo aktiviert. Dein Guthaben wurde belastet.','ok'); await loadMemberDashboard(); }
      catch(error) { fail(error); }
      finally { button.disabled = false; }
    }));

    byId('inventory').innerHTML = (itemRes.data || []).map(item => `<article class="tile"><h3>${esc(item.name)}</h3><p>${esc(item.description)}</p><p>Verfügbar: ${new Intl.NumberFormat('de-DE').format(item.available_quantity)}</p><div class="row"><input class="borrow-quantity" data-item="${item.id}" aria-label="Anzahl ${esc(item.name)}" type="number" min="1" max="${item.available_quantity}" value="1" ${!active || !item.available_quantity ? 'disabled' : ''}><button class="button secondary borrow-item" data-item="${item.id}" ${!active || !item.available_quantity ? 'disabled' : ''}>Ausleihen</button></div></article>`).join('') || '<p class="muted">Noch keine Items im Lager.</p>';
    document.querySelectorAll('.borrow-item').forEach(button => button.addEventListener('click', async () => {
      const qty = Number(document.querySelector(`.borrow-quantity[data-item="${button.dataset.item}"]`)?.value);
      if (!Number.isInteger(qty) || qty < 1) return notify('Bitte eine gültige Stückzahl eingeben.','error');
      button.disabled = true;
      try { await rpc('borrow_item',{p_item_id:Number(button.dataset.item),p_quantity:qty}); notify('Ausleihe wurde eingetragen.','ok'); await loadMemberDashboard(); }
      catch(error) { fail(error); }
      finally { button.disabled = false; }
    }));

    const planById = Object.fromEntries((planRes.data || []).map(p=>[p.id,p.title]));
    byId('transactions').innerHTML = (txRes.data || []).length ? `<table><thead><tr><th>Datum</th><th>Buchung</th><th>Betrag</th></tr></thead><tbody>${txRes.data.map(t=>`<tr><td>${date(t.created_at)}</td><td>${esc(t.reason)}</td><td>${t.amount > 0 ? '+' : ''}${currency(t.amount)}</td></tr>`).join('')}</tbody></table>` : 'Noch keine Buchungen.';
    const itemById = Object.fromEntries((itemRes.data || []).map(i=>[i.id,i.name]));
    byId('loans').innerHTML = (loanRes.data || []).length ? `<table><thead><tr><th>Item</th><th>Menge</th><th>Fällig</th><th>Status</th></tr></thead><tbody>${loanRes.data.map(l=>`<tr><td>${esc(itemById[l.item_id] || 'Item')}</td><td>${l.quantity}</td><td>${date(l.due_at)}</td><td>${l.returned_at ? 'Zurückgegeben' : 'Offen'}</td></tr>`).join('')}</tbody></table>` : 'Noch keine Ausleihen.';
  }

  async function loadAdminPanel() {
    const [profileRes,walletRes,plansRes,itemsRes,loansRes] = await Promise.all([
      client.from('member_profiles').select('user_id,minecraft_name,status,created_at').order('created_at',{ascending:false}),
      client.from('wallet_accounts').select('member_id,balance'),
      client.from('subscription_plans').select('id,title,duration_days,price,active').order('duration_days'),
      client.from('inventory_items').select('id,name,available_quantity').order('name'),
      client.from('item_loans').select('id,member_id,item_id,quantity,borrowed_at,due_at,returned_at').is('returned_at',null).order('due_at')
    ]);
    for (const result of [profileRes,walletRes,plansRes,itemsRes,loansRes]) if (result.error) throw result.error;
    const balances = Object.fromEntries((walletRes.data || []).map(w=>[w.member_id,w.balance]));
    const profiles = profileRes.data || [];
    const approved = profiles.filter(p=>p.status==='approved');
    byId('admin-members').innerHTML = profiles.length ? `<table><thead><tr><th>Minecraft</th><th>Guthaben</th><th>Status</th><th>Aktion</th></tr></thead><tbody>${profiles.map(p=>`<tr><td>${esc(p.minecraft_name)}</td><td>${currency(balances[p.user_id] || 0)}</td><td><span class="badge ${esc(p.status)}">${esc(p.status)}</span></td><td>${p.status==='pending'?`<button class="button approve-member" data-id="${p.user_id}" data-approved="true">Freigeben</button> <button class="button danger approve-member" data-id="${p.user_id}" data-approved="false">Ablehnen</button>`:`<span class="muted">${date(p.created_at)}</span>`}</td></tr>`).join('')}</tbody></table>` : 'Noch keine Mitglieder.';
    const selector = `<option value="">Mitglied auswählen</option>${approved.map(p=>`<option value="${p.user_id}">${esc(p.minecraft_name)}</option>`).join('')}`;
    byId('credit-member').innerHTML = selector;
    document.querySelectorAll('.approve-member').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      try { await rpc('admin_approve_member',{p_member_id:button.dataset.id,p_approved:button.dataset.approved==='true'}); notify(button.dataset.approved==='true'?'Mitglied freigeschaltet.':'Mitglied abgelehnt.','ok'); await loadAdminPanel(); }
      catch(error){fail(error);button.disabled=false;}
    }));
    byId('admin-plans').innerHTML = `<table><thead><tr><th>Abo</th><th>Laufzeit</th><th>Preis (leer = deaktiviert)</th><th></th></tr></thead><tbody>${(plansRes.data||[]).map(p=>`<tr><td>${esc(p.title)}</td><td>${p.duration_days} Tage</td><td><input class="plan-price" data-plan="${esc(p.id)}" type="number" min="1" step="1" value="${p.price ?? ''}" aria-label="Preis ${esc(p.title)}"></td><td><button class="button secondary save-plan" data-plan="${esc(p.id)}">Speichern</button></td></tr>`).join('')}</tbody></table>`;
    document.querySelectorAll('.save-plan').forEach(button=>button.addEventListener('click',async()=>{
      const raw=document.querySelector(`.plan-price[data-plan="${button.dataset.plan}"]`).value;
      const price=raw===''?null:Number(raw);
      if(price!==null&&(!Number.isSafeInteger(price)||price<=0))return notify('Bitte einen gültigen Preis eingeben.','error');
      button.disabled=true;
      try { await rpc('admin_set_plan_price',{p_plan_id:button.dataset.plan,p_price:price}); notify('Abo-Preis gespeichert.','ok'); await loadAdminPanel(); }
      catch(error){fail(error);button.disabled=false;}
    }));
    const items=itemsRes.data||[];
    byId('stock-item').innerHTML=`<option value="">Artikel auswählen</option>${items.map(i=>`<option value="${i.id}">${esc(i.name)} · ${i.available_quantity}</option>`).join('')}`;
    const profileById=Object.fromEntries(profiles.map(p=>[p.user_id,p.minecraft_name]));
    const itemById=Object.fromEntries(items.map(i=>[i.id,i.name]));
    byId('admin-loans').innerHTML=(loansRes.data||[]).length?`<table><thead><tr><th>Mitglied</th><th>Item</th><th>Menge</th><th>Fällig</th><th></th></tr></thead><tbody>${loansRes.data.map(l=>`<tr><td>${esc(profileById[l.member_id]||'Mitglied')}</td><td>${esc(itemById[l.item_id]||'Item')}</td><td>${l.quantity}</td><td>${date(l.due_at)}</td><td><button class="button secondary return-loan" data-id="${l.id}">Rückgabe buchen</button></td></tr>`).join('')}</tbody></table>`:'Keine offenen Ausleihen.';
    document.querySelectorAll('.return-loan').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      try { await rpc('admin_return_loan',{p_loan_id:Number(button.dataset.id)}); notify('Rückgabe gebucht und Bestand erhöht.','ok'); await loadAdminPanel(); }
      catch(error){fail(error);button.disabled=false;}
    }));
  }

  byId('discord-login').addEventListener('click',async()=>{
    const {error}=await client.auth.signInWithOAuth({provider:'discord',options:{redirectTo:location.href.split('#')[0]}});
    if(error)fail(error);
  });
  byId('signout').addEventListener('click',async()=>{const {error}=await client.auth.signOut();if(error)fail(error);});
  byId('profile-form').addEventListener('submit',async(event)=>{
    event.preventDefault();
    const minecraft_name=byId('minecraft-name').value.trim();
    const {error}=await client.from('member_profiles').insert({user_id:currentUser.id,minecraft_name});
    if(error){fail(error);return;}
    notify('Deine Anmeldung wurde an die Gildenleitung gesendet.','ok');
    await enter(currentUser);
  });
  byId('credit-form').addEventListener('submit',async(event)=>{
    event.preventDefault();
    const p_member_id=byId('credit-member').value;
    const p_amount=Number(byId('credit-amount').value);
    const p_reason=byId('credit-reason').value.trim();
    if(!p_member_id)return notify('Bitte ein Mitglied auswählen.','error');
    if(!Number.isSafeInteger(p_amount)||p_amount<=0)return notify('Bitte einen gültigen Betrag eintragen.','error');
    try { await rpc('admin_credit_wallet',{p_member_id,p_amount,p_reason}); event.target.reset(); notify('Gutschrift sicher verbucht.','ok'); await loadAdminPanel(); if(profile?.status==='approved')await loadMemberDashboard(); }
    catch(error){fail(error);}
  });
  byId('stock-form').addEventListener('submit',async(event)=>{
    event.preventDefault();
    const p_item_id=Number(byId('stock-item').value),p_delta=Number(byId('stock-delta').value),p_reason=byId('stock-reason').value.trim();
    if(!p_item_id||!Number.isInteger(p_delta)||p_delta===0)return notify('Bitte Artikel und eine von null verschiedene Änderung wählen.','error');
    try { await rpc('admin_adjust_stock',{p_item_id,p_delta,p_reason}); event.target.reset(); notify('Lagerbewegung verbucht.','ok'); await loadAdminPanel(); if(profile?.status==='approved')await loadMemberDashboard(); }
    catch(error){fail(error);}
  });
  byId('new-item-form').addEventListener('submit',async(event)=>{
    event.preventDefault();
    const p_name=byId('new-item-name').value.trim(),p_description=byId('new-item-description').value.trim(),p_quantity=Number(byId('new-item-quantity').value);
    try { await rpc('admin_add_inventory_item',{p_name,p_description,p_quantity}); event.target.reset(); notify('Artikel zum Lager hinzugefügt.','ok'); await loadAdminPanel(); if(profile?.status==='approved')await loadMemberDashboard(); }
    catch(error){fail(error);}
  });

  client.auth.onAuthStateChange((_event,session)=>{
    if(session?.user) { show('signed-in'); setTimeout(()=>enter(session.user).catch(fail),0); }
    else { currentUser=null;profile=null;isAdmin=false;show('signed-in',false);show('signed-out'); }
  });
  client.auth.getSession().then(({data,error})=>{
    if(error){fail(error);return;}
    if(data.session?.user)enter(data.session.user).catch(fail);
    else show('signed-out');
  });
})();
