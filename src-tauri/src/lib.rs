use std::sync::Mutex;
use std::time::Instant;
use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Manager, PhysicalPosition, Position, WebviewWindow, WindowEvent,
};

#[derive(Default)]
struct AppTrayState {
  last_blur: Mutex<Option<Instant>>,
}

fn position_near_tray(window: &WebviewWindow) {
  let monitor = window
    .current_monitor()
    .ok()
    .flatten()
    .or_else(|| window.primary_monitor().ok().flatten());

  if let Some(mon) = monitor {
    let mon_pos = mon.position();
    let mon_size = mon.size();
    let scale = mon.scale_factor();

    let win_size = window.outer_size().unwrap_or(tauri::PhysicalSize {
      width: (370.0 * scale) as u32,
      height: (540.0 * scale) as u32,
    });

    let win_w = win_size.width as f64;
    let win_h = win_size.height as f64;
    let mon_x = mon_pos.x as f64;
    let mon_y = mon_pos.y as f64;
    let mon_w = mon_size.width as f64;
    let mon_h = mon_size.height as f64;

    let x = (mon_x + mon_w - win_w - (16.0 * scale)).round() as i32;
    let y = (mon_y + mon_h - win_h - (60.0 * scale)).round() as i32;

    let _ = window.set_position(Position::Physical(PhysicalPosition { x, y }));
  }
}

#[tauri::command]
fn hide_window(window: WebviewWindow) {
  let _ = window.hide();
}

#[tauri::command]
fn set_window_vibrancy(window: WebviewWindow, theme: String) {
  #[cfg(target_os = "windows")]
  {
    use window_vibrancy::{apply_acrylic, apply_blur, clear_acrylic, clear_blur};
    if theme == "acrylic" {
      let _ = apply_acrylic(&window, Some((18, 22, 30, 125)))
        .or_else(|_| apply_blur(&window, Some((18, 22, 30, 125))));
    } else {
      let _ = clear_acrylic(&window);
      let _ = clear_blur(&window);
    }
  }
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
  app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![hide_window, set_window_vibrancy, exit_app])
    .setup(|app| {
      app.manage(AppTrayState::default());

      if cfg!(debug_assertions) {
        let _ = app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        );
      }

      let quit_i = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
      let show_i = MenuItem::with_id(app, "show", "Показать Atmos", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

      let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
        .unwrap_or_else(|_| app.default_window_icon().unwrap().clone());
      let win_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))
        .unwrap_or_else(|_| tray_icon.clone());

      if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_icon(win_icon);
        #[cfg(target_os = "windows")]
        {
          use window_vibrancy::{apply_acrylic, apply_blur};
          let _ = apply_acrylic(&window, Some((18, 22, 30, 125)))
            .or_else(|_| apply_blur(&window, Some((18, 22, 30, 125))));

          unsafe {
            #[link(name = "dwmapi")]
            extern "system" {
              fn DwmSetWindowAttribute(
                hwnd: *mut std::ffi::c_void,
                dwAttribute: u32,
                pvAttribute: *const std::ffi::c_void,
                cbAttribute: u32,
              ) -> i32;
            }

            if let Ok(hwnd) = window.hwnd() {
              let preference: u32 = 2; // DWMWCP_ROUND (Windows 11 standard rounded corners)
              let _ = DwmSetWindowAttribute(
                hwnd.0 as _,
                33, // DWMWA_WINDOW_CORNER_PREFERENCE
                &preference as *const _ as _,
                std::mem::size_of::<u32>() as u32,
              );
            }
          }
        }
        position_near_tray(&window);
        let _ = window.show();
        let _ = window.set_focus();
      }

      let _tray = TrayIconBuilder::new()
        .icon(tray_icon)
        .tooltip("Atmos - Генератор атмосферы")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "quit" => {
            app.exit(0);
          }
          "show" => {
            if let Some(window) = app.get_webview_window("main") {
              position_near_tray(&window);
              let _ = window.show();
              let _ = window.set_focus();
            }
          }
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            let app = tray.app_handle();
            if let Some(window) = app.get_webview_window("main") {
              if window.is_visible().unwrap_or(false) {
                let _ = window.hide();
              } else {
                position_near_tray(&window);
                let _ = window.show();
                let _ = window.set_focus();
              }
            }
          }
        })
        .build(app)?;

      Ok(())
    })
    .on_window_event(|window, event| match event {
      WindowEvent::CloseRequested { api, .. } => {
        let _ = window.hide();
        api.prevent_close();
      }
      _ => {}
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
