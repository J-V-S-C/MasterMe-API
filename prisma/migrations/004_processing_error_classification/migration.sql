UPDATE study_materials AS material
SET processing_error = 'O limite diário do provedor de IA foi atingido. Aguarde a renovação da cota ou revise a configuração da API.'
FROM processing_jobs AS job
WHERE job.material_id = material.id
  AND job.status = 'FAILED'
  AND (
    job.last_error ILIKE '%quota exceeded%'
    OR job.last_error ILIKE '%free_tier_requests%'
  );
