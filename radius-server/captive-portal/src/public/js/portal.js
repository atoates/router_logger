/**
 * RouterLogger Captive Portal - Client-side JavaScript
 * Premium glassmorphism design with smooth interactions
 */

(function() {
    'use strict';

    // ============================================
    // DOM Elements
    // ============================================
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const messageEl = document.getElementById('message');
    
    // Email form elements
    const emailForm = document.getElementById('email-form');
    const emailVerifyForm = document.getElementById('email-verify-form');
    const nameInput = document.getElementById('name');
    const verifyEmailSpan = document.getElementById('verify-email');
    const codeInputs = document.querySelectorAll('.code-input');
    const resendBtn = document.getElementById('resend-code');
    
    // Voucher form elements
    const voucherForm = document.getElementById('voucher-form');
    
    // SMS form elements
    const smsForm = document.getElementById('sms-form');
    
    // Hidden fields
    const clientMac = document.getElementById('client-mac')?.value || '';
    const routerMac = document.getElementById('router-mac')?.value || '';
    const routerId = document.getElementById('router-id')?.value || '';
    const loginUrl = document.getElementById('login-url')?.value || '';
    const originalUrl = document.getElementById('original-url')?.value || '';
    
    // CoovaChilli/UAM parameters
    const chilliChallenge = document.getElementById('chilli-challenge')?.value || '';
    const chilliUamip = document.getElementById('chilli-uamip')?.value || '';
    const chilliUamport = document.getElementById('chilli-uamport')?.value || '';
    const chilliLoginUrl = document.getElementById('chilli-login-url')?.value || '';

    // State
    let currentEmail = '';
    let isSubmitting = false;
    
    console.log('Portal config:', { clientMac, routerMac, routerId, loginUrl, originalUrl });
    console.log('CoovaChilli config:', { chilliChallenge, chilliUamip, chilliUamport, chilliLoginUrl });

    // ============================================
    // Registration Form Handler
    // ============================================
    const registerForm = document.getElementById('register-form');
    
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (isSubmitting) return;
            
            const name = document.getElementById('name')?.value.trim();
            const phone = document.getElementById('phone')?.value.trim();
            const email = document.getElementById('email')?.value.trim();
            const terms = document.getElementById('terms')?.checked;
            const newsletter = document.getElementById('newsletter')?.checked;
            
            // Validation
            if (!name) {
                showMessage('Please enter your name', 'error');
                document.getElementById('name')?.focus();
                return;
            }
            
            if (!phone) {
                showMessage('Please enter your phone number', 'error');
                document.getElementById('phone')?.focus();
                return;
            }
            
            if (!email || !isValidEmail(email)) {
                showMessage('Please enter a valid email address', 'error');
                document.getElementById('email')?.focus();
                return;
            }
            
            if (!terms) {
                showMessage('You must agree to the Terms of service', 'error');
                document.getElementById('terms')?.focus();
                return;
            }
            
            isSubmitting = true;
            const submitBtn = document.getElementById('register-submit');
            setButtonLoading(submitBtn, true);
            hideMessage();
            
            try {
                const response = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: name,
                        phone: phone,
                        email: email,
                        newsletter: newsletter,
                        client_mac: clientMac,
                        router_mac: routerMac,
                        router_id: routerId,
                        login_url: loginUrl,
                        original_url: originalUrl,
                        // CoovaChilli/UAM parameters
                        chilli_challenge: chilliChallenge,
                        chilli_uamip: chilliUamip,
                        chilli_uamport: chilliUamport,
                        chilli_login_url: chilliLoginUrl
                    })
                });
                
                const data = await response.json();
                
                if (response.ok && data.success) {
                    showMessage(data.message || 'Registration successful! Connecting...', 'success');
                    
                    // Store session info for the success page
                    sessionStorage.setItem('freeSession', JSON.stringify({
                        duration: data.sessionDuration || 1800,
                        startedAt: new Date().toISOString(),
                        guestName: name,
                        successUrl: data.successUrl,
                        routerLoginUrl: data.routerLoginUrl
                    }));
                    
                    // Handle CoovaChilli activation via hidden iframe
                    const redirectUrl = data.redirect || '/success?type=free';
                    const successUrl = data.successUrl || '/success?type=free';
                    console.log('🔗 Router login URL:', data.routerLoginUrl);
                    console.log('📄 Success page URL:', successUrl);
                    
                    // If we have a CoovaChilli login URL, activate WiFi via iframe then redirect
                    if (data.routerLoginUrl && data.routerLoginUrl.includes('192.168.')) {
                        console.log('🔌 Activating WiFi via CoovaChilli iframe...');
                        
                        // Create hidden iframe to trigger CoovaChilli authentication
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = data.routerLoginUrl;
                        document.body.appendChild(iframe);
                        
                        // Wait for iframe to load, then redirect to success page
                        setTimeout(() => {
                            console.log('✅ WiFi activation complete, redirecting to success page');
                            window.location.replace(successUrl);
                        }, 2000); // 2 second delay to let CoovaChilli authenticate
                    } else {
                        // No CoovaChilli URL, just redirect normally
                        setTimeout(() => {
                            window.location.replace(redirectUrl);
                        }, 500);
                    }
                } else {
                    showMessage(data.message || 'Registration failed. Please try again.', 'error');
                    setButtonLoading(submitBtn, false);
                }
            } catch (err) {
                console.error('Registration error:', err);
                showMessage('Network error. Please try again.', 'error');
                setButtonLoading(submitBtn, false);
            } finally {
                isSubmitting = false;
            }
        });
    }

    // ============================================
    // Tab Navigation
    // ============================================
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;
            
            const tabId = btn.dataset.tab;
            
            // Update buttons
            tabButtons.forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            
            // Update content with animation
            tabContents.forEach(content => {
                content.classList.remove('active');
            });
            
            const targetContent = document.getElementById(`${tabId}-tab`);
            if (targetContent) {
                // Small delay for smoother transition
                setTimeout(() => {
                    targetContent.classList.add('active');
                }, 50);
            }
            
            // Clear any messages
            hideMessage();
        });
    });

    // ============================================
    // Message Display
    // ============================================
    function showMessage(text, type = 'error') {
        const icons = {
            error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
            success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
            warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
        };
        
        messageEl.innerHTML = `${icons[type] || ''} ${text}`;
        messageEl.className = `message ${type}`;
        messageEl.style.display = 'flex';
        
        // Auto-hide success messages
        if (type === 'success') {
            setTimeout(hideMessage, 5000);
        }
    }

    function hideMessage() {
        messageEl.style.display = 'none';
        messageEl.className = 'message';
    }

    // ============================================
    // Button Loading State
    // ============================================
    function setButtonLoading(btn, loading) {
        const textEl = btn.querySelector('.btn-text');
        const loadingEl = btn.querySelector('.btn-loading');
        
        if (loading) {
            btn.disabled = true;
            if (textEl) textEl.style.display = 'none';
            if (loadingEl) loadingEl.style.display = 'inline-flex';
        } else {
            btn.disabled = false;
            if (textEl) textEl.style.display = 'inline';
            if (loadingEl) loadingEl.style.display = 'none';
        }
    }

    // ============================================
    // Email Form Handler
    // ============================================
    if (emailForm) {
        emailForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (isSubmitting) return;
            
            const email = emailInput.value.trim();
            const name = nameInput?.value.trim() || '';
            
            if (!email || !isValidEmail(email)) {
                showMessage('Please enter a valid email address', 'error');
                emailInput.focus();
                return;
            }
            
            isSubmitting = true;
            const submitBtn = document.getElementById('email-submit');
            setButtonLoading(submitBtn, true);
            hideMessage();
            
            try {
                const response = await fetch('/api/auth/email/request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        email, 
                        name,
                        client_mac: clientMac,
                        router_mac: routerMac,
                        router_id: routerId
                    })
                });
                
                const data = await response.json();
                
                if (response.ok && data.success) {
                    currentEmail = email;
                    verifyEmailSpan.textContent = email;
                    
                    // Animate transition to verification form
                    emailForm.style.opacity = '0';
                    emailForm.style.transform = 'translateY(-10px)';
                    
                    setTimeout(() => {
                        emailForm.style.display = 'none';
                        emailVerifyForm.style.display = 'block';
                        emailVerifyForm.style.opacity = '0';
                        emailVerifyForm.style.transform = 'translateY(10px)';
                        
                        requestAnimationFrame(() => {
                            emailVerifyForm.style.transition = 'all 0.3s ease';
                            emailVerifyForm.style.opacity = '1';
                            emailVerifyForm.style.transform = 'translateY(0)';
                            codeInputs[0].focus();
                        });
                    }, 200);
                    
                    showMessage('Verification code sent! Check your email.', 'success');
                } else {
                    showMessage(data.message || 'Failed to send verification code', 'error');
                }
            } catch (err) {
                console.error('Email request error:', err);
                showMessage('Network error. Please try again.', 'error');
            } finally {
                isSubmitting = false;
                setButtonLoading(submitBtn, false);
            }
        });
    }

    // ============================================
    // Code Input Handler
    // ============================================
    codeInputs.forEach((input, index) => {
        // Handle input
        input.addEventListener('input', (e) => {
            const value = e.target.value.replace(/\D/g, ''); // Only digits
            e.target.value = value;
            
            if (value) {
                e.target.classList.add('filled');
                // Move to next input
                if (index < codeInputs.length - 1) {
                    codeInputs[index + 1].focus();
                }
            } else {
                e.target.classList.remove('filled');
            }
            
            // Auto-submit when all filled
            const code = getCodeValue();
            if (code.length === 6) {
                submitVerificationCode();
            }
        });
        
        // Handle backspace
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && index > 0) {
                codeInputs[index - 1].focus();
                codeInputs[index - 1].value = '';
                codeInputs[index - 1].classList.remove('filled');
            }
            
            // Handle paste
            if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                navigator.clipboard.readText().then(text => {
                    const digits = text.replace(/\D/g, '').slice(0, 6);
                    digits.split('').forEach((digit, i) => {
                        if (codeInputs[i]) {
                            codeInputs[i].value = digit;
                            codeInputs[i].classList.add('filled');
                        }
                    });
                    if (digits.length === 6) {
                        submitVerificationCode();
                    }
                });
            }
            
            // Handle arrow keys
            if (e.key === 'ArrowLeft' && index > 0) {
                codeInputs[index - 1].focus();
            }
            if (e.key === 'ArrowRight' && index < codeInputs.length - 1) {
                codeInputs[index + 1].focus();
            }
        });
        
        // Handle paste event
        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text');
            const digits = text.replace(/\D/g, '').slice(0, 6);
            digits.split('').forEach((digit, i) => {
                if (codeInputs[i]) {
                    codeInputs[i].value = digit;
                    codeInputs[i].classList.add('filled');
                }
            });
            if (digits.length === 6) {
                submitVerificationCode();
            }
        });
        
        // Select all on focus
        input.addEventListener('focus', () => {
            input.select();
        });
    });

    function getCodeValue() {
        return Array.from(codeInputs).map(input => input.value).join('');
    }

    // ============================================
    // Verification Form Handler
    // ============================================
    if (emailVerifyForm) {
        emailVerifyForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitVerificationCode();
        });
    }

    async function submitVerificationCode() {
        if (isSubmitting) return;
        
        const code = getCodeValue();
        if (code.length !== 6) {
            showMessage('Please enter the complete 6-digit code', 'error');
            return;
        }
        
        isSubmitting = true;
        const submitBtn = document.getElementById('verify-submit');
        setButtonLoading(submitBtn, true);
        hideMessage();
        
        try {
            const response = await fetch('/api/auth/email/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    email: currentEmail, 
                    code,
                    client_mac: clientMac,
                    router_mac: routerMac,
                    router_id: routerId
                })
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
                showMessage('Connected successfully! Redirecting...', 'success');
                
                // Animate success
                document.querySelector('.portal-card').style.transform = 'scale(0.98)';
                
                setTimeout(() => {
                    window.location.href = data.redirect || '/success';
                }, 1000);
            } else {
                showMessage(data.message || 'Invalid verification code', 'error');
                // Clear inputs on error
                codeInputs.forEach(input => {
                    input.value = '';
                    input.classList.remove('filled');
                });
                codeInputs[0].focus();
            }
        } catch (err) {
            console.error('Verification error:', err);
            showMessage('Network error. Please try again.', 'error');
        } finally {
            isSubmitting = false;
            setButtonLoading(submitBtn, false);
        }
    }

    // ============================================
    // Resend Code Handler
    // ============================================
    if (resendBtn) {
        let resendCooldown = 0;
        
        resendBtn.addEventListener('click', async () => {
            if (resendCooldown > 0 || isSubmitting) return;
            
            isSubmitting = true;
            resendBtn.disabled = true;
            resendBtn.textContent = 'Sending...';
            
            try {
                const response = await fetch('/api/auth/email/request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        email: currentEmail,
                        client_mac: clientMac,
                        router_mac: routerMac,
                        router_id: routerId
                    })
                });
                
                const data = await response.json();
                
                if (response.ok && data.success) {
                    showMessage('New code sent!', 'success');
                    
                    // Start cooldown
                    resendCooldown = 60;
                    const updateCooldown = () => {
                        if (resendCooldown > 0) {
                            resendBtn.textContent = `Resend in ${resendCooldown}s`;
                            resendCooldown--;
                            setTimeout(updateCooldown, 1000);
                        } else {
                            resendBtn.textContent = "Didn't receive it? Resend code";
                            resendBtn.disabled = false;
                        }
                    };
                    updateCooldown();
                } else {
                    showMessage(data.message || 'Failed to resend code', 'error');
                    resendBtn.textContent = "Didn't receive it? Resend code";
                    resendBtn.disabled = false;
                }
            } catch (err) {
                console.error('Resend error:', err);
                showMessage('Network error. Please try again.', 'error');
                resendBtn.textContent = "Didn't receive it? Resend code";
                resendBtn.disabled = false;
            } finally {
                isSubmitting = false;
            }
        });
    }

    // ============================================
    // Voucher Form Handler
    // ============================================
    if (voucherForm) {
        const voucherInput = document.getElementById('voucher');
        
        // Auto-format voucher code
        voucherInput?.addEventListener('input', (e) => {
            let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            // Add dashes every 4 characters
            if (value.length > 4) {
                value = value.match(/.{1,4}/g).join('-');
            }
            e.target.value = value;
        });
        
        voucherForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (isSubmitting) return;
            
            const voucherCode = voucherInput.value.replace(/-/g, '').trim();
            
            if (!voucherCode || voucherCode.length < 4) {
                showMessage('Please enter a valid voucher code', 'error');
                voucherInput.focus();
                return;
            }
            
            isSubmitting = true;
            const submitBtn = document.getElementById('voucher-submit');
            setButtonLoading(submitBtn, true);
            hideMessage();
            
            try {
                const response = await fetch('/api/auth/voucher', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        voucher_code: voucherCode,
                        client_mac: clientMac,
                        router_mac: routerMac,
                        router_id: routerId
                    })
                });
                
                const data = await response.json();
                
                if (response.ok && data.success) {
                    showMessage('Voucher accepted! Connecting...', 'success');
                    setTimeout(() => {
                        window.location.href = data.redirect || '/success';
                    }, 1000);
                } else {
                    showMessage(data.message || 'Invalid voucher code', 'error');
                    voucherInput.value = '';
                    voucherInput.focus();
                }
            } catch (err) {
                console.error('Voucher error:', err);
                showMessage('Network error. Please try again.', 'error');
            } finally {
                isSubmitting = false;
                setButtonLoading(submitBtn, false);
            }
        });
    }

    // ============================================
    // SMS Form Handler
    // ============================================
    if (smsForm) {
        smsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (isSubmitting) return;
            
            const phone = document.getElementById('phone').value.trim();
            const name = document.getElementById('sms-name')?.value.trim() || '';
            
            if (!phone || phone.length < 10) {
                showMessage('Please enter a valid phone number', 'error');
                return;
            }
            
            isSubmitting = true;
            const submitBtn = document.getElementById('sms-submit');
            setButtonLoading(submitBtn, true);
            hideMessage();
            
            try {
                const response = await fetch('/api/auth/sms/request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        phone, 
                        name,
                        client_mac: clientMac,
                        router_mac: routerMac,
                        router_id: routerId
                    })
                });
                
                const data = await response.json();
                
                if (response.ok && data.success) {
                    showMessage('SMS verification not yet implemented', 'warning');
                } else {
                    showMessage(data.message || 'Failed to send SMS', 'error');
                }
            } catch (err) {
                console.error('SMS error:', err);
                showMessage('Network error. Please try again.', 'error');
            } finally {
                isSubmitting = false;
                setButtonLoading(submitBtn, false);
            }
        });
    }

    // ============================================
    // Utility Functions
    // ============================================
    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    // ============================================
    // Keyboard Navigation
    // ============================================
    document.addEventListener('keydown', (e) => {
        // Close message on Escape
        if (e.key === 'Escape') {
            hideMessage();
        }
    });

    // ============================================
    // Initialize
    // ============================================
    console.log('🌐 RouterLogger Captive Portal initialized');
    
    // Focus first input on load
    setTimeout(() => {
        const firstInput = document.querySelector('.tab-content.active input:not([type="hidden"])');
        if (firstInput) {
            firstInput.focus();
        }
    }, 500);

})();
