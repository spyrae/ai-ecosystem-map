/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Project Directory - Path to your project for scanning project-level config files (.cursor/rules, .windsurf/rules, AGENTS.md, CLAUDE.md, etc.) */
  "projectPath"?: string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `search-ecosystem` command */
  export type SearchEcosystem = ExtensionPreferences & {}
  /** Preferences accessible in the `agents` command */
  export type Agents = ExtensionPreferences & {}
  /** Preferences accessible in the `rules` command */
  export type Rules = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `search-ecosystem` command */
  export type SearchEcosystem = {}
  /** Arguments passed to the `agents` command */
  export type Agents = {}
  /** Arguments passed to the `rules` command */
  export type Rules = {}
}

