-- =============================================================================
-- ClearSpend: Receipt embeddings for NL querying (S-03)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add embedding column to receipts
-- ---------------------------------------------------------------------------
ALTER TABLE receipts ADD COLUMN embedding vector(1536);

-- ---------------------------------------------------------------------------
-- 2. HNSW index for cosine similarity search
-- ---------------------------------------------------------------------------
CREATE INDEX receipts_embedding_idx ON receipts
  USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- 3. RPC function for vector similarity search
--    Returns receipts for a given user ordered by cosine similarity.
--    Both the p_user_id parameter filter and the RLS policy (user_id = auth.uid())
--    apply simultaneously, ensuring cross-user access is impossible.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_receipts(
  query_embedding vector(1536),
  match_threshold float,
  match_count     int,
  p_user_id       uuid
)
RETURNS TABLE (
  id            uuid,
  shop_name     text,
  purchase_date date,
  total_amount  numeric,
  similarity    float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    r.id,
    r.shop_name,
    r.purchase_date,
    r.total_amount,
    1 - (r.embedding <=> query_embedding) AS similarity
  FROM receipts r
  WHERE r.user_id           = p_user_id
    AND r.processing_status = 'done'
    AND r.embedding         IS NOT NULL
    AND 1 - (r.embedding <=> query_embedding) > match_threshold
  ORDER BY r.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;
