import SwiftUI

/// FitCheck-In Sync sheet, opened from the Today screen toolbar.
struct FitCheckInSyncView: View {
    @EnvironmentObject private var sync: FitCheckInSyncManager
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var signingIn = false
    @State private var signInError: String?
    @State private var confirmUnlink = false

    var body: some View {
        NavigationStack {
            Form {
                if !sync.isConfigured {
                    Section {
                        Label("FitCheck-In 未配置：请在 Info.plist 设置 FitCheckInSupabaseURL 和 FitCheckInSupabaseAnonKey。", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }
                }

                if let session = sync.session {
                    accountSection(session)
                    categoriesSection
                    syncSection
                    privacySection
                } else {
                    signInSection
                }
            }
            .navigationTitle("FitCheck-In Sync")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } }
            }
            .confirmationDialog("解绑此设备？", isPresented: $confirmUnlink, titleVisibility: .visible) {
                Button("解绑并退出登录", role: .destructive) { Task { await sync.unlinkDevice() } }
            } message: {
                Text("将停止上传并删除本机的同步记录。已上传到 FitCheck-In 的数据可在网页端“设置 › 隐私与数据”中删除。")
            }
        }
    }

    private var signInSection: some View {
        Section {
            TextField("邮箱 Email", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField("密码 Password", text: $password)
                .textContentType(.password)
            if let signInError {
                Text(signInError).font(.footnote).foregroundStyle(.red)
            }
            Button {
                Task {
                    signingIn = true
                    signInError = nil
                    do { try await sync.signIn(email: email, password: password) } catch {
                        signInError = (error as? FitCheckInError)?.localizedDescription ?? error.localizedDescription
                    }
                    signingIn = false
                }
            } label: {
                HStack {
                    if signingIn { ProgressView() }
                    Text("登录 FitCheck-In 客户账号")
                }
            }
            .disabled(signingIn || email.isEmpty || password.count < 8 || !sync.isConfigured)
        } header: {
            Text("连接 FitCheck-In")
        } footer: {
            Text("使用你在 FitCheck-In 网页端注册的客户账号登录。登录凭证保存在本机钥匙串中。")
        }
    }

    private func accountSection(_ session: FitCheckInSession) -> some View {
        Section("账号") {
            LabeledContent("已登录", value: session.email)
            Button("解绑此设备", role: .destructive) { confirmUnlink = true }
        }
    }

    private var categoriesSection: some View {
        Section {
            ForEach(FitCheckInCategory.allCases) { category in
                Toggle(category.title, isOn: Binding(
                    get: { sync.enabledCategories.contains(category) },
                    set: { on in
                        if on { sync.enabledCategories.insert(category) } else { sync.enabledCategories.remove(category) }
                    }
                ))
            }
        } header: {
            Text("上传的数据类型")
        } footer: {
            Text("这里控制 iPhone 读取并上传哪些数据。每位教练能看到哪些数据，需要在网页端“设置 › 健康数据共享”中单独授权。")
        }
    }

    private var syncSection: some View {
        Section {
            Button {
                Task { await sync.syncNow() }
            } label: {
                HStack {
                    Label("立即同步", systemImage: "arrow.triangle.2.circlepath")
                    Spacer()
                    phaseView
                }
            }
            .disabled(isBusy)

            if let last = sync.lastSync {
                LabeledContent("最近同步", value: last.finishedAt.formatted(date: .abbreviated, time: .shortened))
                if let error = last.errorMessage {
                    Text(error).font(.footnote).foregroundStyle(.red)
                } else {
                    LabeledContent("新增 / 已存在", value: "\(last.accepted) / \(last.duplicates)")
                    if last.rejected > 0 { LabeledContent("被拒绝", value: "\(last.rejected)") }
                    if let c = last.completeness { LabeledContent("数据完整度", value: c.formatted(.percent.precision(.fractionLength(0)))) }
                }
            }
            Toggle("后台自动同步（尽力而为）", isOn: $sync.backgroundSyncEnabled)
            Button("重新上传最近 30 天") { Task { await sync.syncNow(fullResync: true) } }
                .disabled(isBusy)
        } header: {
            Text("同步")
        } footer: {
            Text("后台同步使用 Apple 的 HealthKit 后台传送机制，由 iOS 决定唤醒时机，不保证实时。")
        }
    }

    private var privacySection: some View {
        Section("隐私") {
            Text("FitCheck-In 只读取你允许的 Apple 健康数据，并通过 HTTPS 上传到你的账号。评分仅为算法估计，不是医学诊断。")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Link("在“健康”App 中管理读取权限", destination: URL(string: "x-apple-health://")!)
        }
    }

    private var isBusy: Bool {
        switch sync.phase {
        case .authorizing, .reading, .uploading: true
        default: false
        }
    }

    @ViewBuilder private var phaseView: some View {
        switch sync.phase {
        case .idle: EmptyView()
        case .authorizing: Text("授权中…").foregroundStyle(.secondary)
        case .reading: ProgressView()
        case .uploading(let done, let total): Text("上传 \(done + 1)/\(total)").foregroundStyle(.secondary)
        case .success: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .failed: Image(systemName: "xmark.octagon.fill").foregroundStyle(.red)
        }
    }
}
