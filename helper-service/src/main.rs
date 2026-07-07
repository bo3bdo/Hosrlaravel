#![cfg(windows)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    ffi::OsString,
    fs::{create_dir_all, OpenOptions},
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use std::os::windows::process::CommandExt;

use windows_service::{
    define_windows_service,
    service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    },
    service_control_handler::{self, ServiceControlHandlerResult},
    service_dispatcher,
};

const SERVICE_NAME: &str = "LaraboxsHelper";
const SERVICE_DISPLAY_NAME: &str = "laraboxs Helper";
const API_PORT: u16 = 47899;
const CREATE_NO_WINDOW: u32 = 0x08000000;

define_windows_service!(ffi_service_main, service_main);

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.iter().any(|arg| arg == "--install") {
        if let Err(error) = install_service(&args) {
            eprintln!("{error}");
            std::process::exit(1);
        }
        println!("Installed {SERVICE_DISPLAY_NAME} Windows service.");
        return;
    }

    if args.iter().any(|arg| arg == "--uninstall") {
        if let Err(error) = uninstall_service() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        println!("Removed {SERVICE_DISPLAY_NAME} Windows service.");
        return;
    }

    if args.iter().any(|arg| arg == "--run") {
        if let Err(error) = service_dispatcher::start(SERVICE_NAME, ffi_service_main) {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }

    eprintln!(
        "Usage: laraboxs-helper-svc.exe --install [--resource-dir <path>] | --uninstall | --run --resource-dir <path>"
    );
    std::process::exit(2);
}

fn service_main(_arguments: Vec<OsString>) {
    if let Err(error) = run_service(_arguments) {
        log_message(&format!("service failed: {error}"));
    }
}

fn run_service(arguments: Vec<OsString>) -> Result<(), Box<dyn std::error::Error>> {
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_handler = Arc::clone(&stop_flag);

    let event_handler = move |control_event| -> ServiceControlHandlerResult {
        match control_event {
            ServiceControl::Stop | ServiceControl::Shutdown => {
                stop_flag_handler.store(true, Ordering::SeqCst);
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        }
    };

    let status_handle = service_control_handler::register(SERVICE_NAME, event_handler)?;
    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Running,
        controls_accepted: ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;

    let resource_dir = resolve_resource_dir(&arguments)?;
    log_message(&format!(
        "native helper service started with resource dir {}",
        resource_dir.display()
    ));

    let mut child = spawn_helper_api(&resource_dir)?;
    let mut last_restart = Instant::now();

    while !stop_flag.load(Ordering::SeqCst) {
        if helper_api_ready() {
            thread::sleep(Duration::from_millis(500));
            if let Ok(Some(_)) = child.try_wait() {
                if last_restart.elapsed() > Duration::from_secs(2) {
                    log_message("helper API exited unexpectedly; restarting");
                    child = spawn_helper_api(&resource_dir)?;
                    last_restart = Instant::now();
                }
            }
            continue;
        }

        if let Ok(Some(_)) = child.try_wait() {
            if last_restart.elapsed() > Duration::from_secs(2) {
                log_message("helper API is not reachable; restarting child process");
                child = spawn_helper_api(&resource_dir)?;
                last_restart = Instant::now();
            }
        }

        thread::sleep(Duration::from_millis(500));
    }

    log_message("native helper service stopping");
    let _ = request_helper_shutdown();
    let _ = wait_for_child_exit(&mut child, Duration::from_secs(12));
    let _ = child.kill();
    let _ = child.wait();

    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Stopped,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;

    Ok(())
}

fn install_service(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let exe = env::current_exe()?;
    let resource_dir = resolve_resource_dir_from_args(args).unwrap_or_else(|| {
        exe.parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."))
    });

    let bin_path = format!(
        "\"{}\" --run --resource-dir \"{}\"",
        exe.display(),
        resource_dir.display()
    );

    let _ = Command::new("sc.exe").args(["stop", SERVICE_NAME]).status();
    let _ = Command::new("sc.exe").args(["delete", SERVICE_NAME]).status();
    thread::sleep(Duration::from_secs(2));

    let create = Command::new("sc.exe")
        .args([
            "create",
            SERVICE_NAME,
            &format!("binPath= {bin_path}"),
            "start= auto",
            &format!("DisplayName= {SERVICE_DISPLAY_NAME}"),
        ])
        .output()?;

    if !create.status.success() {
        let stderr = String::from_utf8_lossy(&create.stderr);
        return Err(format!("sc.exe create failed: {stderr}").into());
    }

    let _ = Command::new("sc.exe")
        .args([
            "description",
            SERVICE_NAME,
            "Native Windows service that supervises the laraboxs helper API.",
        ])
        .status();
    let _ = Command::new("sc.exe").args(["start", SERVICE_NAME]).status();

    Ok(())
}

fn uninstall_service() -> Result<(), Box<dyn std::error::Error>> {
    let _ = Command::new("sc.exe").args(["stop", SERVICE_NAME]).status();
    thread::sleep(Duration::from_secs(2));
    let delete = Command::new("sc.exe").args(["delete", SERVICE_NAME]).output()?;

    if !delete.status.success() {
        let stderr = String::from_utf8_lossy(&delete.stderr);
        return Err(format!("sc.exe delete failed: {stderr}").into());
    }

    Ok(())
}

fn resolve_resource_dir(arguments: &[OsString]) -> Result<PathBuf, Box<dyn std::error::Error>> {
    resolve_resource_dir_from_args(
        &arguments
            .iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>(),
    )
    .ok_or_else(|| "Missing --resource-dir argument.".into())
}

fn resolve_resource_dir_from_args(args: &[String]) -> Option<PathBuf> {
    args.iter()
        .position(|arg| arg == "--resource-dir")
        .and_then(|index| args.get(index + 1))
        .map(PathBuf::from)
        .or_else(|| env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)))
}

fn spawn_helper_api(resource_dir: &Path) -> Result<Child, Box<dyn std::error::Error>> {
    let node = resource_dir.join("node.exe");
    let server = resource_dir
        .join("app")
        .join("dist")
        .join("api")
        .join("server.js");
    let app_dir = resource_dir.join("app");

    if !node.is_file() || !server.is_file() {
        return Err(format!(
            "helper API resources are incomplete at {} (node={}, server={})",
            resource_dir.display(),
            node.is_file(),
            server.is_file()
        )
        .into());
    }

    let stderr = helper_log_file("helper.err.log")
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null());
    let stdout = helper_log_file("helper.out.log")
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null());

    let mut command = Command::new(node);
    command
        .arg(server)
        .current_dir(&app_dir)
        .env("LARABOXS_API_PORT", API_PORT.to_string())
        .env("NODE_ENV", "production")
        .env("LARABOXS_HELPER_APP_DIR", &app_dir)
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr)
        .creation_flags(CREATE_NO_WINDOW);

    let child = command.spawn()?;
    wait_for_helper_api_ready(Duration::from_secs(15));
    log_message(&format!(
        "spawned helper API child pid {} from {}",
        child.id(),
        resource_dir.display()
    ));
    Ok(child)
}

fn helper_api_ready() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], API_PORT));
    TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

fn wait_for_helper_api_ready(timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if helper_api_ready() {
            return;
        }
        thread::sleep(Duration::from_millis(200));
    }
}

fn request_helper_shutdown() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], API_PORT));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(500)) else {
        return false;
    };
    let request = format!(
        "POST /api/shutdown HTTP/1.1\r\nHost: 127.0.0.1:{API_PORT}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
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

fn helper_log_file(name: &str) -> std::io::Result<std::fs::File> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(helper_log_path(name)?)
}

fn helper_log_path(name: &str) -> std::io::Result<PathBuf> {
    let home = env::var_os("USERPROFILE")
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "USERPROFILE is not set"))?;
    let log_dir = PathBuf::from(home).join(".config").join("laraboxs");
    create_dir_all(&log_dir)?;
    Ok(log_dir.join(name))
}

fn log_message(message: &str) {
    if let Ok(path) = helper_log_path("helper-svc.log") {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{message}");
        }
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("laraboxs-helper-svc is only supported on Windows.");
    std::process::exit(1);
}
