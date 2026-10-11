# LTE-Mitgliederbereich einrichten

Der Bereich besteht aus `mitglieder.html`, `assets/member-app.js` und einer Supabase-Datenbankmigration. Die öffentliche Seite enthält ausschließlich Supabase-Projektadresse und Publishable Key. Discord-Client-Secret und Supabase Secret/Service-Keys bleiben in den jeweiligen Dashboards.

## Was bereits vorbereitet ist

- Anmeldung über Discord OAuth; neue Mitglieder melden ihren Minecraft-Namen an und bleiben bis zur Admin-Freigabe gesperrt.
- Private Profile, eigenes Guthaben, Buchungsverlauf, Abos und Ausleihen.
- Admin-Portal mit Freigaben, manuellen Guthabenbuchungen, Preisverwaltung, Lagerbuchungen und Rückgabeerfassung.
- Datenbankregeln blockieren direkte Guthabenänderungen durch Mitglieder. Käufe und Ausleihen laufen über transaktionale Datenbankfunktionen.
- Startbestand: 3.000 Diamanterz-Blöcke. Das 1-Monats-Abo kostet 500.000 Spielgeld. Die Preise der Laufzeiten 7 Tage, 3 Monate und 1 Jahr bleiben zunächst leer und sind dadurch nicht kaufbar, bis der Admin Preise setzt.

## Aktivierung

1. Erstelle ein Supabase-Projekt und öffne dessen SQL Editor.
2. Führe einmal `supabase/migrations/202610110001_member_portal.sql` vollständig aus.
3. Öffne Supabase **Authentication → URL Configuration**. Setze als Site URL `https://luisha806.github.io/LTE-LowTempoElite/` und trage `https://luisha806.github.io/LTE-LowTempoElite/mitglieder.html` als Redirect URL ein.
4. Erstelle im [Discord Developer Portal](https://discord.com/developers/applications) eine OAuth-App. Als Redirect URI der Discord-App verwendest du die Callback-URL, die Supabase unter **Authentication → Providers → Discord** anzeigt (`https://<projekt-ref>.supabase.co/auth/v1/callback`). Hinterlege Discord Client ID und Client Secret ausschließlich in Supabase.
5. Trage in `assets/member-config.js` die Supabase Project URL und den Publishable Key ein. Einen Secret- oder Service-Role-Key darfst du dort nicht eintragen.
6. Veröffentliche die Website und melde dich einmal mit deinem Discord-Konto an. Reiche dein Minecraft-Profil ein. Im Portal wird deine Auth-User-ID angezeigt.
7. Füge genau diese UUID im Supabase SQL Editor als ersten Administrator ein:

   ```sql
   insert into private.admin_users (user_id)
   values ('DEINE-AUTH-USER-UUID');
   ```

8. Melde dich im Mitgliederportal ab und wieder an. Im Admin-Panel kannst du dein Profil freigeben, weitere Mitglieder zulassen, Guthaben buchen und die noch offenen Abo-Preise setzen.

## Spielgeld und Verleih

Mitglieder bezahlen außerhalb der Website im Spiel. Erst wenn du die Überweisung erhalten hast, buchst du im Admin-Panel den Betrag mit einem nachvollziehbaren Grund gut. Das Guthaben ist Website-Spielgeld; es wird nicht automatisch mit dem separaten Discord-Bot-Wallet abgeglichen. Ein aktives Abo erlaubt Ausleihen bis zum Ende seiner Laufzeit. Eine Rückgabe wird erst wieder als verfügbarer Lagerbestand gezählt, wenn du sie im Admin-Panel bestätigst.

## Wichtige Sicherheitseinstellung

Die Datenbankmigration aktiviert Row Level Security, entzieht direkte Schreibrechte auf Guthaben, Abos, Bestand und Ausleihen und vergibt Adminrechte nur über die private Admin-Tabelle. Veröffentliche keine Supabase Secret/Service-Keys und entferne die RLS-Regeln nicht. OAuth und Datenbankzugriff sind erst aktiv, nachdem die Konten in Supabase und Discord eingerichtet und die öffentlichen Projektwerte in `assets/member-config.js` gesetzt wurden.
