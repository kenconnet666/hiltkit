import { createApp } from 'vue'; // vue@3.5.44，虚拟 DOM
import { makeBench } from '../data.js';
import App from './App.vue';
import { actions } from './state.js';

createApp(App).mount(document.body.appendChild(document.createElement('div')));
window.bench = makeBench(actions);
