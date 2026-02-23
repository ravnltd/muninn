export { matchers } from './matchers.js';

export const nodes = [
	() => import('./nodes/0'),
	() => import('./nodes/1'),
	() => import('./nodes/2'),
	() => import('./nodes/3'),
	() => import('./nodes/4'),
	() => import('./nodes/5'),
	() => import('./nodes/6'),
	() => import('./nodes/7'),
	() => import('./nodes/8'),
	() => import('./nodes/9'),
	() => import('./nodes/10'),
	() => import('./nodes/11'),
	() => import('./nodes/12'),
	() => import('./nodes/13'),
	() => import('./nodes/14'),
	() => import('./nodes/15'),
	() => import('./nodes/16'),
	() => import('./nodes/17'),
	() => import('./nodes/18'),
	() => import('./nodes/19'),
	() => import('./nodes/20')
];

export const server_loads = [];

export const dictionary = {
		"/(marketing)": [8,[3]],
		"/dashboard": [11,[4]],
		"/dashboard/api-keys": [12,[4]],
		"/dashboard/billing": [13,[4]],
		"/dashboard/knowledge": [14,[4,5]],
		"/dashboard/knowledge/graph": [15,[4,5]],
		"/dashboard/knowledge/reports": [16,[4,5]],
		"/dashboard/knowledge/timeline": [17,[4,5]],
		"/dashboard/settings": [18,[4]],
		"/dashboard/team": [19,[4]],
		"/dashboard/usage": [20,[4]],
		"/(marketing)/docs": [9,[3]],
		"/(auth)/login": [6,[2]],
		"/(marketing)/pricing": [10,[3]],
		"/(auth)/signup": [7,[2]]
	};

export const hooks = {
	handleError: (({ error }) => { console.error(error) }),
	
	reroute: (() => {}),
	transport: {}
};

export const decoders = Object.fromEntries(Object.entries(hooks.transport).map(([k, v]) => [k, v.decode]));
export const encoders = Object.fromEntries(Object.entries(hooks.transport).map(([k, v]) => [k, v.encode]));

export const hash = false;

export const decode = (type, value) => decoders[type](value);

export { default as root } from '../root.js';