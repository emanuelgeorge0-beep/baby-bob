-- techniker_funktion_update.sql
-- Idempotentes UPDATE der öffentlichen GS-Techniker-Funktionen (gs_techniker).
-- Funktion/Qualifikation liegt im JSON-Sidecar der Spalte `notizen`; die
-- Spezialisierung zusätzlich in der echten Spalte `specialization` (forward-compatible).
-- Mehrfach ausführbar – das Ergebnis ist immer identisch (Filter über die stabile E-Mail).
-- In Supabase → SQL Editor einfügen und ausführen.

-- Emanuel George – Sanitärmeister / Projektleiter Sanitär-, Heizungs- und Kältetechnik
UPDATE gs_techniker SET
  notizen = '{"photo_emoji":"👨‍💼","qualification":"Sanitärmeister · Projektleiter Sanitär-, Heizungs- & Kältetechnik","specialization":["Sanitär","Heizung","Klima"],"rating":5,"years_experience":15,"location":"Zürich"}',
  specialization = ARRAY['Sanitär','Heizung','Klima']
WHERE email = 'emanuel.george@georgesolutions.ch';

-- Patrick Notter (Geschäftspartner) – EFZ Sanitär, EFZ Heizung; Chefmonteur / Projektleiter
UPDATE gs_techniker SET
  notizen = '{"photo_emoji":"🔧","qualification":"EFZ Sanitär & Heizung · Chefmonteur / Projektleiter Sanitär- & Heizungstechnik","specialization":["Sanitär","Heizung"],"rating":4.8,"years_experience":8,"location":"Zürich"}',
  specialization = ARRAY['Sanitär','Heizung']
WHERE email = 'patrick.notter@georgesolutions.ch';

-- Dimitri Grill – Heizungsmeister / Bauleitender Sanitärmonteur
UPDATE gs_techniker SET
  notizen = '{"photo_emoji":"🔧","qualification":"Heizungsmeister · Bauleitender Sanitärmonteur","specialization":["Heizung","Sanitär"],"rating":4.7,"years_experience":6,"location":"Zürich"}',
  specialization = ARRAY['Heizung','Sanitär']
WHERE email = 'techniker.test@georgesolutions.ch';

-- Vasil Ignatov – Sanitär-/Heizungsmonteur
UPDATE gs_techniker SET
  notizen = '{"photo_emoji":"🔧","qualification":"Sanitär-/Heizungsmonteur","specialization":["Sanitär","Heizung"],"rating":4.8,"years_experience":7,"location":"Zürich"}',
  specialization = ARRAY['Sanitär','Heizung']
WHERE email = 'vasil.ignatov@georgesolutions.ch';
