# Implementation Plan - Fixing Map Editing Deletions and State Sync

This plan details the changes required to resolve regressions in the HongHac City Map editing system that prevented the deletion of POIs, routes, destinations, and always-visible areas, and fixed the segment selection bug when drawing routes.

## User Review Required

> [!IMPORTANT]
> **State Synchronization Refactor (Auto-Save on Input Blur / Interaction)**
> We are changing the synchronization flow in the `RoutingEditor` component. Instead of relying solely on a manual "Lưu cấu hình" button at the bottom (which was prone to being bypassed or overwritten by map interactions), we will automatically save changes:
> - **Immediately** for toggle switches, sliders, color pickers, and deletion actions.
> - **On Blur (`onBlur`)** for text input fields (e.g., Destination Names, Route Names, Route Labels).
> This ensures the parent state is always the Single Source of Truth and prevents map actions from overwriting local edits.

> [!NOTE]
> **Click Event Conflict Resolution**
> We will fix the route segment selection issues where clicking road segments during routing mode was hijacked by the background road GeoJSON layer's hover/click detector.

## Proposed Changes

### Component Layer

#### [MODIFY] [MapView.jsx](file:///g:/HONGHAC/map/HongHacCityMap/components/MapView.jsx)

- Update the background GeoJSON layer's line segment click interceptor (`hitLayer` inside `onEachFeature`) to inherit the feature's style interactivity state (`interactive: style.interactive`).
- Since `style.interactive` evaluates to `false` when `activeRouteEdit` is active, this will disable the background roads' click handlers and allow mouse clicks to pass through directly to the graph segments editor.

#### [MODIFY] [SettingsPanel.jsx](file:///g:/HONGHAC/map/HongHacCityMap/components/SettingsPanel.jsx)

- Refactor `RoutingEditor` to auto-save settings using functional state updates:
  - Add functional update wrappers like `updateRouteFieldAndSave` that apply styling updates (color, weight, dashed styling, label visibility, font sizes, zoom limits) to both local `routingConfig` state and parent `onSave` immediately.
  - Add `onBlur={handleSaveConfig}` to text inputs (Destination Name, Route Name, Route Label Text) so that typing updates local state instantly and persists to the database as soon as the user focuses away or interacts with the map.
  - Retain the manual "Lưu cấu hình" button at the bottom as an extra explicit save option but rely primarily on the seamless auto-save flow.
- Ensure the `deleteDestination` and `deleteRoute` actions immediately push changes via `onSave` and trigger the correct active selection resets.

## Verification Plan

### Automated/Manual Browser Tests
We will execute a browser subagent script to test the full lifecycle of editing and deletion:
1. **Route Deletion**: Delete the "HH-Hồ Tây" route and check that it disappears from the list and is saved.
2. **POI Deletion**: Add a new POI, select it, click delete, and ensure it disappears from both the map and side panel.
3. **Always Visible Clear**: Click "Xóa hết" on the pre-displayed areas and verify the count resets to 0.
4. **Drawing Interactivity**: Enter Route Editing mode, click on road segments, and verify that segments can be toggled (added/removed) successfully without clicking background road features instead.
