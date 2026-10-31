import { mount } from 'svelte';
import { makeBench } from '../data.js';
import App from './App.svelte';
import { actions } from './state.svelte.js';

mount(App, { target: document.body });
window.bench = makeBench(actions);
