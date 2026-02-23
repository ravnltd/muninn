
// this file is generated — do not edit it


/// <reference types="@sveltejs/kit" />

/**
 * Environment variables [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env`. Like [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), this module cannot be imported into client-side code. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured).
 * 
 * _Unlike_ [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), the values exported from this module are statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * ```ts
 * import { API_KEY } from '$env/static/private';
 * ```
 * 
 * Note that all environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * 
 * ```
 * MY_FEATURE_FLAG=""
 * ```
 * 
 * You can override `.env` values from the command line like so:
 * 
 * ```sh
 * MY_FEATURE_FLAG="enabled" npm run dev
 * ```
 */
declare module '$env/static/private' {
	export const SHELL: string;
	export const npm_command: string;
	export const COREPACK_ENABLE_AUTO_PIN: string;
	export const NVM_INC: string;
	export const NODE: string;
	export const ANTHROPIC_API_KEY: string;
	export const npm_config_local_prefix: string;
	export const PWD: string;
	export const MUNINN_GLOBAL_PROJECTS: string;
	export const LOGNAME: string;
	export const XDG_SESSION_TYPE: string;
	export const VOYAGE_API_KEY: string;
	export const _: string;
	export const NoDefaultCurrentDirectoryInExePath: string;
	export const CLAUDECODE: string;
	export const HOME: string;
	export const LANG: string;
	export const LS_COLORS: string;
	export const npm_package_version: string;
	export const LC_TERMINAL: string;
	export const SSH_CONNECTION: string;
	export const npm_lifecycle_script: string;
	export const MUNINN_MODE: string;
	export const NVM_DIR: string;
	export const LESSCLOSE: string;
	export const XDG_SESSION_CLASS: string;
	export const TERM: string;
	export const npm_package_name: string;
	export const LESSOPEN: string;
	export const LIBVIRT_DEFAULT_URI: string;
	export const USER: string;
	export const LC_TERMINAL_VERSION: string;
	export const npm_lifecycle_event: string;
	export const SHLVL: string;
	export const NVM_CD_FLAGS: string;
	export const GIT_EDITOR: string;
	export const XDG_SESSION_ID: string;
	export const npm_config_user_agent: string;
	export const MUNINN_PRIMARY_URL: string;
	export const OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: string;
	export const npm_execpath: string;
	export const XDG_RUNTIME_DIR: string;
	export const SSH_CLIENT: string;
	export const CLAUDE_CODE_ENTRYPOINT: string;
	export const npm_package_json: string;
	export const BUN_INSTALL: string;
	export const XDG_DATA_DIRS: string;
	export const PATH: string;
	export const DBUS_SESSION_BUS_ADDRESS: string;
	export const NVM_BIN: string;
	export const SSH_TTY: string;
	export const npm_node_execpath: string;
	export const OLDPWD: string;
	export const NODE_ENV: string;
}

/**
 * Similar to [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private), except that it only includes environment variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Values are replaced statically at build time.
 * 
 * ```ts
 * import { PUBLIC_BASE_URL } from '$env/static/public';
 * ```
 */
declare module '$env/static/public' {
	
}

/**
 * This module provides access to runtime environment variables, as defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured).
 * 
 * This module cannot be imported into client-side code.
 * 
 * ```ts
 * import { env } from '$env/dynamic/private';
 * console.log(env.DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` always includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 */
declare module '$env/dynamic/private' {
	export const env: {
		SHELL: string;
		npm_command: string;
		COREPACK_ENABLE_AUTO_PIN: string;
		NVM_INC: string;
		NODE: string;
		ANTHROPIC_API_KEY: string;
		npm_config_local_prefix: string;
		PWD: string;
		MUNINN_GLOBAL_PROJECTS: string;
		LOGNAME: string;
		XDG_SESSION_TYPE: string;
		VOYAGE_API_KEY: string;
		_: string;
		NoDefaultCurrentDirectoryInExePath: string;
		CLAUDECODE: string;
		HOME: string;
		LANG: string;
		LS_COLORS: string;
		npm_package_version: string;
		LC_TERMINAL: string;
		SSH_CONNECTION: string;
		npm_lifecycle_script: string;
		MUNINN_MODE: string;
		NVM_DIR: string;
		LESSCLOSE: string;
		XDG_SESSION_CLASS: string;
		TERM: string;
		npm_package_name: string;
		LESSOPEN: string;
		LIBVIRT_DEFAULT_URI: string;
		USER: string;
		LC_TERMINAL_VERSION: string;
		npm_lifecycle_event: string;
		SHLVL: string;
		NVM_CD_FLAGS: string;
		GIT_EDITOR: string;
		XDG_SESSION_ID: string;
		npm_config_user_agent: string;
		MUNINN_PRIMARY_URL: string;
		OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: string;
		npm_execpath: string;
		XDG_RUNTIME_DIR: string;
		SSH_CLIENT: string;
		CLAUDE_CODE_ENTRYPOINT: string;
		npm_package_json: string;
		BUN_INSTALL: string;
		XDG_DATA_DIRS: string;
		PATH: string;
		DBUS_SESSION_BUS_ADDRESS: string;
		NVM_BIN: string;
		SSH_TTY: string;
		npm_node_execpath: string;
		OLDPWD: string;
		NODE_ENV: string;
		[key: `PUBLIC_${string}`]: undefined;
		[key: `${string}`]: string | undefined;
	}
}

/**
 * Similar to [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), but only includes variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Note that public dynamic environment variables must all be sent from the server to the client, causing larger network requests — when possible, use `$env/static/public` instead.
 * 
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.PUBLIC_DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 */
declare module '$env/dynamic/public' {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
