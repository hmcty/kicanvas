/*
    Copyright (c) 2022 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { Barrier, later } from "../../base/async";
import { Disposables, type IDisposable } from "../../base/disposable";
import { listen } from "../../base/events";
import { no_self_recursion } from "../../base/functions";
import { BBox, Vec2 } from "../../base/math";
import { Color, Polygon, Polyline, Renderer } from "../../graphics";
import {
    KiCanvasLoadEvent,
    KiCanvasMouseMoveEvent,
    KiCanvasSelectEvent,
    type KiCanvasEventMap,
} from "./events";
import { ViewLayerSet } from "./view-layers";
import { Viewport } from "./viewport";

/**
 * Marker options for customizing marker appearance
 */
export interface MarkerOptions {
    color?: Color | string;
    radius?: number;
    strokeWidth?: number;
    shape?: 'circle' | 'arrow';
}

/**
 * Internal marker representation
 */
interface Marker {
    id: string;
    position: Vec2;
    color: Color;
    radius: number;
    strokeWidth: number;
    shape: 'circle' | 'arrow';
    visible: boolean;
}

export abstract class Viewer extends EventTarget {
    public renderer: Renderer;
    public viewport: Viewport;
    public layers: ViewLayerSet;
    public mouse_position: Vec2 = new Vec2(0, 0);
    public loaded = new Barrier();

    protected disposables = new Disposables();
    protected setup_finished = new Barrier();

    #selected: BBox | null;
    #markers: Map<string, Marker> = new Map();
    #marker_counter = 0;

    constructor(
        public canvas: HTMLCanvasElement,
        protected interactive = true,
    ) {
        super();
    }

    dispose() {
        this.disposables.dispose();
    }

    override addEventListener<K extends keyof KiCanvasEventMap>(
        type: K,
        listener:
            | ((this: Viewer, ev: KiCanvasEventMap[K]) => void)
            | { handleEvent: (ev: KiCanvasEventMap[K]) => void }
            | null,
        options?: boolean | AddEventListenerOptions,
    ): IDisposable;
    override addEventListener(
        type: string,
        listener: EventListener | null,
        options?: boolean | AddEventListenerOptions,
    ): IDisposable {
        super.addEventListener(type, listener, options);
        return {
            dispose: () => {
                this.removeEventListener(type, listener, options);
            },
        };
    }

    protected abstract create_renderer(canvas: HTMLCanvasElement): Renderer;

    async setup() {
        this.renderer = this.disposables.add(this.create_renderer(this.canvas));

        await this.renderer.setup();

        this.viewport = this.disposables.add(
            new Viewport(this.renderer, () => {
                this.on_viewport_change();
            }),
        );

        if (this.interactive) {
            this.viewport.enable_pan_and_zoom(0.5, 190);

            this.disposables.add(
                listen(this.canvas, "mousemove", (e) => {
                    this.on_mouse_change(e);
                }),
            );

            this.disposables.add(
                listen(this.canvas, "panzoom", (e) => {
                    this.on_mouse_change(e as MouseEvent);
                }),
            );

            this.disposables.add(
                listen(this.canvas, "click", (e) => {
                    const items = this.layers.query_point(this.mouse_position);
                    this.on_pick(this.mouse_position, items);
                }),
            );
        }

        this.setup_finished.open();
    }

    protected on_viewport_change() {
        if (this.interactive) {
            this.draw();
        }
    }

    protected on_mouse_change(e: MouseEvent) {
        const rect = this.canvas.getBoundingClientRect();
        const new_position = this.viewport.camera.screen_to_world(
            new Vec2(e.clientX - rect.left, e.clientY - rect.top),
        );

        if (
            this.mouse_position.x != new_position.x ||
            this.mouse_position.y != new_position.y
        ) {
            this.mouse_position.set(new_position);
            this.dispatchEvent(new KiCanvasMouseMoveEvent(this.mouse_position));
        }
    }

    public abstract load(src: any): Promise<void>;

    protected resolve_loaded(value: boolean) {
        if (value) {
            this.loaded.open();
            this.dispatchEvent(new KiCanvasLoadEvent());
        }
    }

    public abstract paint(): void;

    protected on_draw() {
        this.renderer.clear_canvas();

        if (!this.layers) {
            return;
        }

        // Render all layers in display order (back to front)
        let depth = 0.01;
        const camera = this.viewport.camera.matrix;
        const should_dim = this.layers.is_any_layer_highlighted();

        // TODO: donot flip drawing sheet and grid

        for (const layer of this.layers.in_display_order()) {
            if (layer.visible && layer.graphics) {
                let alpha = layer.opacity;

                if (should_dim && !layer.highlighted) {
                    alpha = 0.25;
                }

                layer.graphics.render(camera, depth, alpha);
                depth += 0.01;
            }
        }
    }

    public draw() {
        if (!this.viewport) {
            return;
        }

        window.requestAnimationFrame(() => {
            this.on_draw();
        });
    }

    protected on_pick(
        mouse: Vec2,
        items: ReturnType<ViewLayerSet["query_point"]>,
    ) {
        let selected = null;

        for (const { bbox } of items) {
            selected = bbox;
            break;
        }

        this.select(selected);
    }

    public select(item: BBox | null) {
        this.selected = item;
    }

    public get selected(): BBox | null {
        return this.#selected;
    }

    public set selected(bb: BBox | null) {
        this._set_selected(bb);
    }

    @no_self_recursion
    private _set_selected(bb: BBox | null) {
        const previous = this.#selected;
        this.#selected = bb?.copy() || null;

        // Notify event listeners
        this.dispatchEvent(
            new KiCanvasSelectEvent({
                item: this.#selected?.context,
                previous: previous?.context,
            }),
        );

        later(() => this.paint_selected());
    }

    public get selection_color() {
        return Color.white;
    }

    protected paint_selected() {
        const layer = this.layers.overlay;

        layer.clear();

        this.renderer.start_layer(layer.name);

        // Paint selection if present
        if (this.#selected) {
            const bb = this.#selected.copy().grow(this.#selected.w * 0.1);

            this.renderer.line(
                Polyline.from_BBox(bb, 0.254, this.selection_color),
            );

            this.renderer.polygon(Polygon.from_BBox(bb, this.selection_color));
        }

        // Paint markers
        for (const marker of this.#markers.values()) {
            // Skip hidden markers
            if (!marker.visible) continue;

            if (marker.shape === 'arrow') {
                // Draw arrow pointing at the position
                const size = marker.radius * 2;
                const headHeight = size * 1.2;
                const shaftWidth = size * 0.3;
                const shaftHeight = size * 2.5;

                // Arrow head (triangle pointing down at the marker position)
                const headPoints: Vec2[] = [
                    new Vec2(marker.position.x, marker.position.y),  // tip
                    new Vec2(marker.position.x - size / 2, marker.position.y - headHeight),  // left
                    new Vec2(marker.position.x + size / 2, marker.position.y - headHeight),  // right
                    new Vec2(marker.position.x, marker.position.y),  // back to tip
                ];

                // Arrow shaft (rectangle)
                const shaftTop = marker.position.y - headHeight;
                const shaftPoints: Vec2[] = [
                    new Vec2(marker.position.x - shaftWidth / 2, shaftTop),
                    new Vec2(marker.position.x + shaftWidth / 2, shaftTop),
                    new Vec2(marker.position.x + shaftWidth / 2, shaftTop - shaftHeight),
                    new Vec2(marker.position.x - shaftWidth / 2, shaftTop - shaftHeight),
                    new Vec2(marker.position.x - shaftWidth / 2, shaftTop),
                ];

                // Draw filled shapes
                const headPolygon = new Polygon(headPoints, marker.color);
                this.renderer.polygon(headPolygon);

                const shaftPolygon = new Polygon(shaftPoints, marker.color);
                this.renderer.polygon(shaftPolygon);

                // Draw strokes
                const strokeColor = marker.color.copy();
                strokeColor.a = Math.min(1.0, strokeColor.a * 1.5);
                this.renderer.line(headPoints, marker.strokeWidth, strokeColor);
                this.renderer.line(shaftPoints, marker.strokeWidth, strokeColor);
            } else {
                // Draw filled circle
                this.renderer.circle(marker.position, marker.radius, marker.color);

                // Draw stroke
                const strokeColor = marker.color.copy();
                strokeColor.a = Math.min(1.0, strokeColor.a * 1.5);

                // Create a circle outline using a polyline
                const segments = 32;
                const points: Vec2[] = [];
                for (let i = 0; i <= segments; i++) {
                    const angle = (i / segments) * Math.PI * 2;
                    const px = marker.position.x + Math.cos(angle) * marker.radius;
                    const py = marker.position.y + Math.sin(angle) * marker.radius;
                    points.push(new Vec2(px, py));
                }

                this.renderer.line(points, marker.strokeWidth, strokeColor);
            }
        }

        layer.graphics = this.renderer.end_layer();

        if (this.#selected) {
            layer.graphics.composite_operation = "overlay";
        } else {
            layer.graphics.composite_operation = "source-over";
        }

        this.draw();
    }

    abstract zoom_to_page(): void;

    zoom_to_selection() {
        if (!this.selected) {
            return;
        }
        this.viewport.camera.bbox = this.selected.grow(10);
        this.draw();
    }

    flip_view() {
        const flip = !this.viewport.camera.flipped;

        this.viewport.camera.flipped = flip;

        for (const layer of this.layers.in_order()) {
            if (layer.graphics) {
                layer.graphics.renderer.state.flipped = flip;
            }
        }

        // We need redraw some items because some items are not flippable
        // TODO: it re-paint all items and is inefficient
        this.paint();
        this.draw();
    }

    /**
     * Add a marker at the specified world coordinates
     * @param x - X coordinate in world space
     * @param y - Y coordinate in world space
     * @param options - Optional customization options
     * @returns The marker ID that can be used to remove it later
     */
    public addMarker(
        x: number,
        y: number,
        options?: MarkerOptions,
    ): string {
        const id = `marker_${this.#marker_counter++}`;

        let color: Color;
        if (options?.color) {
            if (typeof options.color === "string") {
                color = Color.from_css(options.color);
            } else {
                color = options.color;
            }
        } else {
            color = Color.from_css("#FF0000"); // Default red
        }

        const marker: Marker = {
            id,
            position: new Vec2(x, y),
            color,
            radius: options?.radius ?? 2.0,
            strokeWidth: options?.strokeWidth ?? 0.5,
            shape: options?.shape ?? 'circle',
            visible: true,
        };

        this.#markers.set(id, marker);
        later(() => this.paint_selected());
        return id;
    }

    /**
     * Remove a marker by its ID
     * @param id - The marker ID returned by addMarker
     */
    public removeMarker(id: string): void {
        if (this.#markers.delete(id)) {
            later(() => this.paint_selected());
        }
    }

    /**
     * Remove all markers
     */
    public clearMarkers(): void {
        this.#markers.clear();
        later(() => this.paint_selected());
    }

    /**
     * Get all current marker IDs
     */
    public getMarkerIds(): string[] {
        return Array.from(this.#markers.keys());
    }

    /**
     * Set visibility of all markers
     * @param visible - true to show markers, false to hide them
     */
    public setMarkersVisible(visible: boolean): void {
        for (const marker of this.#markers.values()) {
            marker.visible = visible;
        }
        later(() => this.paint_selected());
    }

    /**
     * Toggle visibility of all markers
     * @returns The new visibility state
     */
    public toggleMarkersVisible(): boolean {
        // If any marker is visible, hide all. Otherwise show all.
        const anyVisible = Array.from(this.#markers.values()).some(m => m.visible);
        const newState = !anyVisible;

        for (const marker of this.#markers.values()) {
            marker.visible = newState;
        }
        later(() => this.paint_selected());
        return newState;
    }
}
