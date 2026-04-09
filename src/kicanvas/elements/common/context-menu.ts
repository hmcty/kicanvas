/*
    Copyright (c) 2026 Harrison McCarty.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { css, html } from "../../../base/web-components";
import { KCUIElement } from "../../../kc-ui/element";

export class KCContextMenuElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        css`
            :host {
                position: fixed;
                z-index: 1000;
                display: none;
            }

            :host([visible]) {
                display: block;
            }

            .menu {
                background: var(--dropdown-bg);
                border-radius: 5px;
                overflow: hidden;
                min-width: 150px;
                max-width: 300px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            }

            .menu-item {
                display: block;
                padding: 0.4em 0.8em;
                cursor: pointer;
                color: var(--dropdown-fg);
                user-select: none;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .menu-item:hover {
                background: var(--dropdown-hover-bg);
                color: var(--dropdown-hover-fg);
            }
        `,
    ];

    #items: Map<string, unknown> | null = null;
    #onSelect: ((value: unknown) => void) | null = null;
    #boundHandleOutsideClick: ((e: MouseEvent) => void) | null = null;
    #boundHandleDismiss: (() => void) | null = null;

    show<T>(
        screenX: number,
        screenY: number,
        items: Map<string, unknown>,
        onSelect: (value: T) => void,
    ) {
        this.#items = items;
        this.#onSelect = onSelect as (value: unknown) => void;

        this.style.left = `${screenX}px`;
        this.style.top = `${screenY}px`;

        this.setAttribute("visible", "");

        requestAnimationFrame(() => {
            this.updateMenuItems();
            this.adjustPosition();
            this.setupDismissListeners();
        });
    }

    hide() {
        this.removeAttribute("visible");
        this.#items = null;
        this.#onSelect = null;
        this.removeDismissListeners();
    }

    private updateMenuItems() {
        const menu = this.shadowRoot?.querySelector(".menu");
        if (!menu) return;

        menu.innerHTML = "";
        this.#items?.forEach((item, name) => {
            const menuItem = document.createElement("div");
            menuItem.className = "menu-item";
            // menuItem.dataset["index"] = name;
            menuItem.textContent = name;
            menu.appendChild(menuItem);
        });
    }

    private adjustPosition() {
        const rect = this.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let x = parseFloat(this.style.left);
        let y = parseFloat(this.style.top);

        if (x + rect.width > viewportWidth) {
            x = viewportWidth - rect.width - 10;
        }
        if (y + rect.height > viewportHeight) {
            y = viewportHeight - rect.height - 10;
        }

        this.style.left = `${Math.max(10, x)}px`;
        this.style.top = `${Math.max(10, y)}px`;
    }

    private setupDismissListeners() {
        // Dismiss context window on outside click, window resize, or scroll
        this.removeDismissListeners();

        this.#boundHandleOutsideClick = (e: MouseEvent) => {
            const rect = this.getBoundingClientRect();
            const isInside =
                e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom;

            if (!isInside) {
                this.hide();
            }
        };

        this.#boundHandleDismiss = () => this.hide();

        setTimeout(() => {
            if (this.#boundHandleOutsideClick) {
                document.addEventListener(
                    "pointerdown",
                    this.#boundHandleOutsideClick,
                );
            }

            if (this.#boundHandleDismiss) {
                window.addEventListener("resize", this.#boundHandleDismiss);
                window.addEventListener(
                    "scroll",
                    this.#boundHandleDismiss,
                    true,
                );
            }
        }, 100);
    }

    private removeDismissListeners() {
        if (this.#boundHandleOutsideClick) {
            document.removeEventListener(
                "pointerdown",
                this.#boundHandleOutsideClick,
            );
            this.#boundHandleOutsideClick = null;
        }

        if (this.#boundHandleDismiss) {
            window.removeEventListener("resize", this.#boundHandleDismiss);
            window.removeEventListener(
                "scroll",
                this.#boundHandleDismiss,
                true,
            );
            this.#boundHandleDismiss = null;
        }
    }

    override initialContentCallback() {
        super.initialContentCallback();

        this.shadowRoot?.addEventListener("click", (e: Event) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains("menu-item") && this.#items) {
                if (this.#onSelect) {
                    this.#onSelect(this.#items.get(target.textContent ?? ""));
                }

                this.hide();
            }
        });
    }

    override render() {
        return html`<div class="menu"></div>`;
    }
}

window.customElements.define("kc-context-menu", KCContextMenuElement);

