#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    fs::{create_dir_all, OpenOptions},
    io::Write,
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::Manager;

const API_PORT: u16 = 47899;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct ApiProcess(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let child = start_helper_api(app.path().resource_dir()?);
            app.manage(ApiProcess(Mutex::new(child?)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building laraboxs")
        .run(|app_handle, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                stop_helper_api(app_handle);
            }
        });
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
