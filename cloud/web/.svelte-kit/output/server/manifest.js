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
		client: {start:"_app/immutable/entry/start.DfTbtbRb.js",app:"_app/immutable/entry/app.DA91WmMB.js",imports:["_app/immutable/entry/start.DfTbtbRb.js","_app/immutable/chunks/CjyPjQ-n.js","_app/immutable/chunks/BJmdqduM.js","_app/immutable/chunks/DgI_gUZc.js","_app/immutable/chunks/D1MHOrrt.js","_app/immutable/entry/app.DA91WmMB.js","_app/immutable/chunks/BJmdqduM.js","_app/immutable/chunks/9hSCU5Uy.js","_app/immutable/chunks/Dp4zGy6Y.js","_app/immutable/chunks/D1MHOrrt.js","_app/immutable/chunks/eWemM8hH.js","_app/immutable/chunks/CvwpLTzV.js","_app/immutable/chunks/DgI_gUZc.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js')),
			__memo(() => import('./nodes/4.js')),
			__memo(() => import('./nodes/5.js')),
			__memo(() => import('./nodes/6.js')),
			__memo(() => import('./nodes/10.js')),
			__memo(() => import('./nodes/11.js')),
			__memo(() => import('./nodes/12.js')),
			__memo(() => import('./nodes/13.js')),
			__memo(() => import('./nodes/14.js')),
			__memo(() => import('./nodes/15.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/dashboard",
				pattern: /^\/dashboard\/?$/,
				params: [],
				page: { layouts: [0,3,], errors: [1,,], leaf: 6 },
				endpoint: null
			},
			{
				id: "/dashboard/api-keys",
				pattern: /^\/dashboard\/api-keys\/?$/,
				params: [],
				page: { layouts: [0,3,], errors: [1,,], leaf: 7 },
				endpoint: null
			},
			{
				id: "/dashboard/billing",
				pattern: /^\/dashboard\/billing\/?$/,
				params: [],
				page: { layouts: [0,3,], errors: [1,,], leaf: 8 },
				endpoint: null
			},
			{
				id: "/dashboard/settings",
				pattern: /^\/dashboard\/settings\/?$/,
				params: [],
				page: { layouts: [0,3,], errors: [1,,], leaf: 9 },
				endpoint: null
			},
			{
				id: "/dashboard/team",
				pattern: /^\/dashboard\/team\/?$/,
				params: [],
				page: { layouts: [0,3,], errors: [1,,], leaf: 10 },
				endpoint: null
			},
			{
				id: "/dashboard/usage",
				pattern: /^\/dashboard\/usage\/?$/,
				params: [],
				page: { layouts: [0,3,], errors: [1,,], leaf: 11 },
				endpoint: null
			},
			{
				id: "/(auth)/login",
				pattern: /^\/login\/?$/,
				params: [],
				page: { layouts: [0,2,], errors: [1,,], leaf: 4 },
				endpoint: null
			},
			{
				id: "/(auth)/signup",
				pattern: /^\/signup\/?$/,
				params: [],
				page: { layouts: [0,2,], errors: [1,,], leaf: 5 },
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
