
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	export interface AppTypes {
		RouteId(): "/(marketing)" | "/(auth)" | "/" | "/dashboard" | "/dashboard/api-keys" | "/dashboard/billing" | "/dashboard/knowledge" | "/dashboard/knowledge/graph" | "/dashboard/knowledge/reports" | "/dashboard/knowledge/timeline" | "/dashboard/settings" | "/dashboard/team" | "/dashboard/usage" | "/(marketing)/docs" | "/(auth)/login" | "/(marketing)/pricing" | "/(auth)/signup";
		RouteParams(): {
			
		};
		LayoutParams(): {
			"/(marketing)": Record<string, never>;
			"/(auth)": Record<string, never>;
			"/": Record<string, never>;
			"/dashboard": Record<string, never>;
			"/dashboard/api-keys": Record<string, never>;
			"/dashboard/billing": Record<string, never>;
			"/dashboard/knowledge": Record<string, never>;
			"/dashboard/knowledge/graph": Record<string, never>;
			"/dashboard/knowledge/reports": Record<string, never>;
			"/dashboard/knowledge/timeline": Record<string, never>;
			"/dashboard/settings": Record<string, never>;
			"/dashboard/team": Record<string, never>;
			"/dashboard/usage": Record<string, never>;
			"/(marketing)/docs": Record<string, never>;
			"/(auth)/login": Record<string, never>;
			"/(marketing)/pricing": Record<string, never>;
			"/(auth)/signup": Record<string, never>
		};
		Pathname(): "/" | "/dashboard" | "/dashboard/api-keys" | "/dashboard/billing" | "/dashboard/knowledge" | "/dashboard/knowledge/graph" | "/dashboard/knowledge/reports" | "/dashboard/knowledge/timeline" | "/dashboard/settings" | "/dashboard/team" | "/dashboard/usage" | "/docs" | "/login" | "/pricing" | "/signup";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/favicon.svg" | string & {};
	}
}