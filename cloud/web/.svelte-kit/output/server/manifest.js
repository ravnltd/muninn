export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["favicon.svg"]),
	mimeTypes: {".svg":"image/svg+xml"},
	_: {
		client: {start:"_app/immutable/entry/start.Bd1ZLiDS.js",app:"_app/immutable/entry/app.ZRx6dhCr.js",imports:["_app/immutable/entry/start.Bd1ZLiDS.js","_app/immutable/chunks/DtQHt172.js","_app/immutable/chunks/DEIXV2yr.js","_app/immutable/chunks/U58iku0o.js","_app/immutable/chunks/DKpGyjba.js","_app/immutable/entry/app.ZRx6dhCr.js","_app/immutable/chunks/xPaU1tKI.js","_app/immutable/chunks/DEIXV2yr.js","_app/immutable/chunks/Bv3bKQ8S.js","_app/immutable/chunks/BQbrFHdE.js","_app/immutable/chunks/DKpGyjba.js","_app/immutable/chunks/BKTWmeyc.js","_app/immutable/chunks/Ba5SyZl2.js","_app/immutable/chunks/kH2wg-ph.js","_app/immutable/chunks/U58iku0o.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js')),
			__memo(() => import('./nodes/4.js')),
			__memo(() => import('./nodes/5.js')),
			__memo(() => import('./nodes/6.js')),
			__memo(() => import('./nodes/7.js')),
			__memo(() => import('./nodes/11.js')),
			__memo(() => import('./nodes/12.js')),
			__memo(() => import('./nodes/13.js')),
			__memo(() => import('./nodes/14.js')),
			__memo(() => import('./nodes/15.js')),
			__memo(() => import('./nodes/16.js')),
			__memo(() => import('./nodes/17.js')),
			__memo(() => import('./nodes/18.js')),
			__memo(() => import('./nodes/19.js')),
			__memo(() => import('./nodes/20.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/dashboard",
				pattern: /^\/dashboard\/?$/,
				params: [],
				page: { layouts: [0,3,], errors: [1,,], leaf: 7 },
				endpoint: null
			},
			{
				id: "/dashboard/api-keys",
				pattern: /^\/dashboard\/api-keys\/?$/,
				params: [],
				page: { layouts: [0,3,], errors: [1,,], leaf: 8 },
				endpoint: null
			},
			{
				id: "/dashboard/billing",
				pattern: /^\/dashboard\/billing\/?$/,
				params: [],
				page: { layouts: [0,3,], errors: [1,,], leaf: 9 },
				endpoint: null
			},
			{
				id: "/dashboard/knowledge",
				pattern: /^\/dashboard\/knowledge\/?$/,
				params: [],
				page: { layouts: [0,3,4,], errors: [1,,,], leaf: 10 },
				endpoint: null
			},
			{
				id: "/dashboard/knowledge/graph",
				pattern: /^\/dashboard\/knowledge\/graph\/?$/,
				params: [],
				page: { layouts: [0,3,4,], errors: [1,,,], leaf: 11 },
				endpoint: null
			},
			{
				id: "/dashboard/knowledge/reports",
				pattern: /^\/dashboard\/knowledge\/reports\/?$/,
				params: [],
				page: { layouts: [0,3,4,], errors: [1,,,], leaf: 12 },
				endpoint: null
			},
			{
				id: "/dashboard/knowledge/timeline",
				pattern: /^\/dashboard\/knowledge\/timeline\/?$/,
				params: [],
				page: { layouts: [0,3,4,], errors: [1,,,], leaf: 13 },
				endpoint: null
			},
			{
				id: "/dashboard/settings",
				pattern: /^\/dashboard\/settings\/?$/,
				params: [],
				page: { layouts: [0,3,], errors: [1,,], leaf: 14 },
				endpoint: null
			},
			{
				id: "/dashboard/team",
				pattern: /^\/dashboard\/team\/?$/,
				params: [],
				page: { layouts: [0,3,], errors: [1,,], leaf: 15 },
				endpoint: null
			},
			{
				id: "/dashboard/usage",
				pattern: /^\/dashboard\/usage\/?$/,
				params: [],
				page: { layouts: [0,3,], errors: [1,,], leaf: 16 },
				endpoint: null
			},
			{
				id: "/(auth)/login",
				pattern: /^\/login\/?$/,
				params: [],
				page: { layouts: [0,2,], errors: [1,,], leaf: 5 },
				endpoint: null
			},
			{
				id: "/(auth)/signup",
				pattern: /^\/signup\/?$/,
				params: [],
				page: { layouts: [0,2,], errors: [1,,], leaf: 6 },
				endpoint: null
			}
		],
		prerendered_routes: new Set(["/","/docs","/pricing"]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
