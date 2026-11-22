-- Fallback model attached to a credential.
--
-- When the provider rejects the primary model with a failure another model can
-- fix (503 UNAVAILABLE / high demand, 429, 5xx, model not found), the same key
-- retries once with this model instead. NULL means "use the provider default
-- defined in code", and `AI_FALLBACK_MODEL` overrides it for env-only setups.
ALTER TABLE "api_key" ADD COLUMN IF NOT EXISTS "fallback_model" text;
