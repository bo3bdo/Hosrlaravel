#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    fs::{create_dir_all, OpenOptions},
    io::{Read, Write},
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
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !args_request_hidden(&args) {
                show_main_window(app);
            }
        }));
    }

    builder
        .setup(|app| {
            let child = start_helper_api(app.path().resource_dir()?);
            app.manage(ApiProcess(Mutex::new(child?)));
            app.manage(AppExit(AtomicBool::new(false)));
            setup_tray(app)?;
            if launch_hidden() {
                hide_main_window(app.handle());
            }
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
    let Some(resource_dir) = helper_resource_dir(resource_dir) else {
        log_helper_api("helper API resources were not found");
        return Ok(None);
    };

    let app_dir = normalize_windows_path(resource_dir.join("app"));
    let node = helper_node_executable(&resource_dir);
    let server = app_dir.join("dist").join("api").join("server.js");

    if helper_api_owned_by(&app_dir) {
        log_helper_api("helper API for this installation is already listening");
        return Ok(None);
    }

    if helper_api_ready() {
        log_helper_api("helper API port is busy; trying to stop stale laraboxs helper");
        stop_stale_helper_api();
        wait_for_helper_api_to_stop();
    }

    if helper_api_ready() {
        log_helper_api("helper API port is still busy after stale helper cleanup");
        return Ok(None);
    }

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
        .env("LARABOXS_HELPER_APP_DIR", resource_dir.join("app"))
        .env("LARABOXS_DESKTOP_EXE", current_exe_path())
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
        let node = helper_node_executable(&candidate);
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

fn helper_node_executable(resource_dir: &PathBuf) -> PathBuf {
    #[cfg(debug_assertions)]
    {
        if let Some(path) = env::var_os("LARABOXS_NODE") {
            let configured = PathBuf::from(path);
            if configured.is_file() {
                return normalize_windows_path(configured);
            }
        }

        #[cfg(windows)]
        {
            let mut command = Command::new("where.exe");
            command
                .arg("node")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            command.creation_flags(CREATE_NO_WINDOW);
            if let Ok(output) = command.output()
            {
                if output.status.success() {
                    if let Ok(stdout) = String::from_utf8(output.stdout) {
                        if let Some(first) = stdout.lines().map(str::trim).find(|line| !line.is_empty()) {
                            let system_node = PathBuf::from(first);
                            if system_node.is_file() {
                                log_helper_api(format!("using system Node for dev: {}", system_node.display()));
                                return normalize_windows_path(system_node);
                            }
                        }
                    }
                }
            }
        }
    }

    normalize_windows_path(resource_dir.join("node.exe"))
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

fn args_request_hidden(args: &[String]) -> bool {
    args.iter()
        .any(|arg| arg == "--hidden" || arg == "--startup")
}

fn launch_hidden() -> bool {
    args_request_hidden(&env::args().collect::<Vec<_>>())
}

fn current_exe_path() -> PathBuf {
    env::current_exe()
        .map(normalize_windows_path)
        .unwrap_or_else(|_| PathBuf::new())
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

fn helper_api_owned_by(app_dir: &PathBuf) -> bool {
    let Some(body) = helper_api_health_body() else {
        return false;
    };

    normalize_for_compare(&body).contains(&normalize_for_compare(&app_dir.display().to_string()))
}

fn helper_api_health_body() -> Option<String> {
    let address = SocketAddr::from(([127, 0, 0, 1], API_PORT));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(300)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let request = format!(
        "GET /api/health.txt HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        API_PORT
    );
    stream.write_all(request.as_bytes()).ok()?;

    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    if !response.starts_with("HTTP/1.1 200") && !response.starts_with("HTTP/1.0 200") {
        return None;
    }

    response.split("\r\n\r\n").nth(1).map(|body| body.to_string())
}

fn wait_for_helper_api_to_stop() {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if !helper_api_ready() {
            return;
        }
        thread::sleep(Duration::from_millis(200));
    }
}

fn request_helper_api_shutdown() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], API_PORT));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let request = format!(
        "POST /api/shutdown HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        API_PORT
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = [0_u8; 256];
    let _ = stream.read(&mut response);
    true
}

fn wait_for_child_exit(child: &mut Child, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(_) => return false,
        }
    }
    false
}

fn normalize_for_compare(value: &str) -> String {
    value
        .replace("\\\\?\\UNC\\", "\\\\")
        .replace("\\\\?\\", "")
        .replace('/', "\\")
        .to_lowercase()
}

#[cfg(windows)]
fn stop_stale_helper_api() {
    let script = format!(
        "$port = {port}; \
         $connections = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction SilentlyContinue; \
         foreach ($connection in $connections) {{ \
           $processId = $connection.OwningProcess; \
           $process = Get-CimInstance Win32_Process -Filter \"ProcessId = $processId\" -ErrorAction SilentlyContinue; \
           $line = (($process.ExecutablePath, $process.CommandLine) -join ' '); \
           if ($line -match 'laraboxs') {{ Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }} \
         }}",
        port = API_PORT
    );

    let _ = Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(not(windows))]
fn stop_stale_helper_api() {}

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
        if request_helper_api_shutdown() && wait_for_child_exit(&mut child, Duration::from_secs(12)) {
            log_helper_api("helper API stopped gracefully");
            return;
        }

        let _ = child.kill();
        let _ = child.wait();
        log_helper_api("helper API force-stopped");
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
