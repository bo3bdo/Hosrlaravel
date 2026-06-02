#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    fs::{create_dir_all, OpenOptions},
    io::Write,
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

const API_PORT: u16 = 47899;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct ApiProcess(Mutex<Option<Child>>);
struct AppExit(AtomicBool);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let child = start_helper_api(app.path().resource_dir()?);
            app.manage(ApiProcess(Mutex::new(child?)));
            app.manage(AppExit(AtomicBool::new(false)));
            setup_tray(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building laraboxs")
        .run(|app_handle, event| {
            match event {
                tauri::RunEvent::WindowEvent {
                    event: WindowEvent::CloseRequested { api, .. },
                    ..
                } => {
                    let is_quitting = app_handle
                        .try_state::<AppExit>()
                        .map(|state| state.0.load(Ordering::SeqCst))
                        .unwrap_or(false);

                    if !is_quitting {
                        api.prevent_close();
                        hide_main_window(app_handle);
                    }
                }
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                    stop_helper_api(app_handle);
                }
                _ => {}
            }
        });
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Open laraboxs", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide window", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit laraboxs", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &hide, &separator, &quit])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("laraboxs is running")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "hide" => hide_main_window(app),
            "quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { button, .. } = event {
                if button == MouseButton::Left {
                    show_main_window(tray.app_handle());
                }
                return;
            }

            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if button == MouseButton::Left && button_state == MouseButtonState::Down {
                    show_main_window(tray.app_handle());
                }
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

fn show_main_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn quit_app(app_handle: &tauri::AppHandle) {
    if let Some(state) = app_handle.try_state::<AppExit>() {
        state.0.store(true, Ordering::SeqCst);
    }
    app_handle.exit(0);
}

fn start_helper_api(resource_dir: PathBuf) -> Result<Option<Child>, Box<dyn std::error::Error>> {
    if helper_api_ready() {
        log_helper_api("helper API is already listening");
        return Ok(None);
    }

    let Some(resource_dir) = helper_resource_dir(resource_dir) else {
        log_helper_api("helper API resources were not found");
        return Ok(None);
    };

    let app_dir = normalize_windows_path(resource_dir.join("app"));
    let node = normalize_windows_path(resource_dir.join("node.exe"));
    let server = app_dir.join("dist").join("api").join("server.js");
    let stderr = helper_log_file("helper.err.log").map(Stdio::from).unwrap_or_else(|_| Stdio::null());
    let stdout = helper_log_file("helper.out.log").map(Stdio::from).unwrap_or_else(|_| Stdio::null());

    if !node.is_file() || !server.is_file() {
        log_helper_api(format!(
            "helper API resources are incomplete. resource_dir={}, node_exists={}, server_exists={}",
            resource_dir.display(),
            node.is_file(),
            server.is_file()
        ));
        return Ok(None);
    }

    let mut command = Command::new(node);
    command
        .arg(server)
        .current_dir(app_dir)
        .env("LARABOXS_API_PORT", API_PORT.to_string())
        .env("NODE_ENV", "production")
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    log_helper_api(format!("starting helper API from {}", resource_dir.display()));
    let mut child = command.spawn()?;
    wait_for_helper_api(&mut child);
    log_helper_api(format!("helper API spawned with pid {}", child.id()));
    Ok(Some(child))
}

fn helper_resource_dir(resource_dir: PathBuf) -> Option<PathBuf> {
    let mut candidates = vec![resource_dir];
    if let Ok(exe) = env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.to_path_buf());
        }
    }

    for candidate in candidates {
        let node = candidate.join("node.exe");
        let server = candidate.join("app").join("dist").join("api").join("server.js");
        log_helper_api(format!(
            "checking helper API resources at {}: node_exists={}, server_exists={}",
            candidate.display(),
            node.is_file(),
            server.is_file()
        ));
        if node.is_file() && server.is_file() {
            return Some(normalize_windows_path(candidate));
        }
    }

    None
}

fn normalize_windows_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let path_string = path.display().to_string();
        if let Some(stripped) = path_string.strip_prefix("\\\\?\\UNC\\") {
            return PathBuf::from(format!("\\\\{}", stripped));
        }
        if let Some(stripped) = path_string.strip_prefix("\\\\?\\") {
            return PathBuf::from(stripped);
        }
    }

    path
}

fn wait_for_helper_api(child: &mut Child) {
    let deadline = Instant::now() + Duration::from_secs(10);

    while Instant::now() < deadline {
        if helper_api_ready() {
            return;
        }

        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }

        thread::sleep(Duration::from_millis(200));
    }
}

fn helper_api_ready() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], API_PORT));
    TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_ok()
}

fn stop_helper_api(app_handle: &tauri::AppHandle) {
    let child = {
        let state = app_handle.state::<ApiProcess>();
        let child = match state.0.lock() {
            Ok(mut child_slot) => child_slot.take(),
            Err(_) => None,
        };
        child
    };

    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
        log_helper_api("helper API stopped");
    }
}

fn log_helper_api(message: impl AsRef<str>) {
    let Ok(log_path) = helper_log_path("helper.log") else {
      return;
    };

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(file, "{}", message.as_ref());
    }
}

fn helper_log_file(name: &str) -> std::io::Result<std::fs::File> {
    OpenOptions::new().create(true).append(true).open(helper_log_path(name)?)
}

fn helper_log_path(name: &str) -> std::io::Result<PathBuf> {
    let local_app_data = env::var_os("LOCALAPPDATA")
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "LOCALAPPDATA is not set"))?;
    let log_dir = PathBuf::from(local_app_data).join("laraboxs");
    create_dir_all(&log_dir)?;
    Ok(log_dir.join(name))
}

fn main() {
    run();
}
