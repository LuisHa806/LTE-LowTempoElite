# LTE-Lagerverwaltung einrichten

Diese Funktion ist bewusst auf das Gildenlager begrenzt. Sie hat keine Mitgliederkonten, Guthaben oder Abos. Ein Discordkonto darf Bestand und Buchungen erst sehen, nachdem es von Luis als Lageradmin freigeschaltet wurde.

## Funktionen

- Aktueller Bestand pro Item mit Kategorie und letzter Änderung.
- Einlagerungen und Ausgaben mit Menge, Spielername, Notiz und Zeitstempel.
- Bestand wird atomar erhöht oder verringert; Ausgaben über dem vorhandenen Bestand werden abgewiesen.
- Artikel können mit einem Anfangsbestand angelegt werden.
- Startbestand: 3.000 Diamanterz-Blöcke.
- Vollständiges Bewegungsprotokoll der letzten 100 Buchungen.

## Aktivierung

1. Erstelle ein Supabase-Projekt und führe `supabase/migrations/202610110001_inventory_only.sql` einmal im SQL Editor aus.
2. Setze in Supabase **Authentication → URL Configuration** die Site URL auf `https://luisha806.github.io/LTE-LowTempoElite/` und ergänze `https://luisha806.github.io/LTE-LowTempoElite/lager.html` als Redirect URL.
3. Erstelle im [Discord Developer Portal](https://discord.com/developers/applications) eine OAuth-App. Als Redirect URI verwendest du die Callback-URL, die Supabase unter **Authentication → Providers → Discord** anzeigt (`https://<projekt-ref>.supabase.co/auth/v1/callback`). Hinterlege Discord Client ID und Client Secret ausschließlich in Supabase.
4. Trage Supabase Project URL und Publishable Key in `assets/inventory-config.js` ein. Niemals den Secret-/Service-Role-Key in die Website oder ins GitHub-Repository kopieren.
5. Veröffentliche die Website, melde dich einmal auf `/lager.html` mit deinem Discordkonto an und notiere die angezeigte Konto-UUID.
6. Trage diese UUID einmalig im Supabase SQL Editor als LTE-Lageradmin ein:

   ```sql
   insert into private.lte_inventory_admins (user_id)
   values ('DEINE-AUTH-USER-UUID');
   ```

7. Melde dich auf der Lagerseite ab und wieder an. Danach kannst du Items und Lagerbuchungen verwalten.

## Erfassung im Alltag

Bei jedem Eingang oder Ausgang buchst du Item, Stückzahl, Spieler und einen kurzen Grund. Zum Beispiel: „Projekt Spawn – 64 Blöcke ausgegeben“ oder „Rückgabe von WuchiTV“. Der Bestand und die Historie ändern sich sofort. Nicht vermerkt werden automatisch Discord-Bot-Verleihvorgänge; diese Seite ist eine eigene Lagerliste.
