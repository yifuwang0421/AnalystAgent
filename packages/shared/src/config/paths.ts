/**
 * Centralized path configuration for Analyst Agent.
 *
 * Supports multi-instance development via ANALYST_CONFIG_DIR environment variable.
 * CRAFT_CONFIG_DIR remains a compatibility alias for existing local scripts.
 * When running from a numbered folder (e.g., craft-tui-agent-1), the detect-instance.sh
 * script sets CRAFT_CONFIG_DIR to ~/.analyst-agent-1, allowing multiple instances to run
 * simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.analyst-agent/
 * Instance 1 (-1 suffix): ~/.analyst-agent-1/
 * Instance 2 (-2 suffix): ~/.analyst-agent-2/
 */

import { homedir } from 'os';
import { join } from 'path';

// Allow override via environment variable for multi-instance dev
// Falls back to default ~/.analyst-agent/ for production and non-numbered dev folders
export const LEGACY_CONFIG_DIR = join(homedir(), '.analyst-agent');
export const CONFIG_DIR = process.env.ANALYST_CONFIG_DIR
  || process.env.CRAFT_CONFIG_DIR
  || join(homedir(), '.analyst-agent');
export const SHOULD_MIGRATE_LEGACY_CONFIG =
  !process.env.ANALYST_CONFIG_DIR && !process.env.CRAFT_CONFIG_DIR && CONFIG_DIR !== LEGACY_CONFIG_DIR;
