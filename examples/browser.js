import { createGamepadManager } from '../src/browser.js';

const pads = createGamepadManager();
const root = document.querySelector('#controllers');
const status = document.querySelector('#status');
const views = new Map();

pads.on('connect', ({ controller }) => {
    const article = document.createElement('article');
    const heading = document.createElement('h2');
    const output = document.createElement('pre');
    heading.textContent = controller.descriptor.name;
    article.append(heading, output);
    if (controller.descriptor.capabilities.rumble) {
        const button = document.createElement('button');
        button.textContent = 'Test rumble';
        button.addEventListener('click', async () => {
            try {
                await controller.rumble({ low: 0.3, high: 0.2, duration: 0.2 });
            } catch (error) {
                status.textContent = error.message;
            }
        });
        article.append(button);
    }
    root.append(article);
    views.set(controller.id, { article, output });
    status.textContent = `${pads.controllers.length} controller(s) connected.`;
});
pads.on('change', ({ controller, state }) => {
    const pressed = Object.fromEntries(
        Object.entries(state.buttons).filter(([, button]) => button.pressed || button.value > 0),
    );
    views.get(controller.id).output.textContent = JSON.stringify(
        { axes: state.axes, buttons: pressed },
        null,
        4,
    );
});
pads.on('disconnect', ({ controller }) => {
    views.get(controller.id)?.article.remove();
    views.delete(controller.id);
    status.textContent = `${pads.controllers.length} controller(s) connected.`;
});
pads.on('error', ({ error }) => {
    status.textContent = error.message;
});
globalThis.addEventListener('pagehide', () => {
    void pads.stop();
});
await pads.start();
