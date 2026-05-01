-- D1 schema for ai-ideator (ARCH-001 §8.3)

CREATE TABLE IF NOT EXISTS eval_results (
  idea_id TEXT NOT NULL,
  judge_id TEXT NOT NULL,
  rubric_id TEXT NOT NULL,
  rubric_param TEXT NOT NULL,
  score REAL NOT NULL,
  confidence REAL NOT NULL,
  notes TEXT,
  run_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (idea_id, judge_id, rubric_id, rubric_param)
);

CREATE INDEX idx_eval_goal ON eval_results (goal_id);
CREATE INDEX idx_eval_run ON eval_results (run_id);

CREATE TABLE IF NOT EXISTS processed_artifacts (
  artifact_hash TEXT PRIMARY KEY,
  wiki_path TEXT,
  concept_ids TEXT,
  processed_at TEXT NOT NULL DEFAULT (datetime('now')),
  forge_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS predictor_training (
  combination_id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  features TEXT NOT NULL,
  predicted REAL NOT NULL,
  actual REAL NOT NULL,
  prediction_err REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_predictor_goal ON predictor_training (goal_id);
