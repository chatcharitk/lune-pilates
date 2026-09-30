-- The owner writes each class's "about this class" text (2026-09-30).
--
-- Until now it was one built-in sentence per class TYPE, so every group class —
-- Cardio Flow, Stretch & Release, Upper Body Tone — carried the same description.
--
-- class_templates.description: set once per weekly slot, and read LIVE through
--   class_instances.template_id, so editing it updates classes already generated
--   from that slot (it is display text, not a term anyone agreed to).
-- class_instances.description: an override for one class.
-- Both null → the class type's built-in description, exactly as before.
alter table class_templates add column if not exists description text;
alter table class_instances add column if not exists description text;
