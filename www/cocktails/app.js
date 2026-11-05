import {payment} from './config.js';
const $=id=>document.getElementById(id);
const digits=payment.account.replace(/\D/g,'');
const formatted=digits.length===13?`${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6)}`:payment.account;
$('account').textContent=formatted;
const amount=document.body.dataset.amount;
if(!['3000','23000'].includes(amount))throw new Error('Invalid page amount');
const amountText=Number(amount).toLocaleString('ko-KR')+'원';
const copyText=`${payment.bank} ${formatted} ${amountText}`;
async function copyAccount(){
 try{if(!navigator.clipboard?.writeText)throw Error('clipboard unavailable');await navigator.clipboard.writeText(copyText);return true;}
 catch{const el=document.createElement('textarea');el.value=copyText;el.setAttribute('readonly','');el.style.cssText='position:fixed;top:0;left:0;opacity:0;font-size:16px';document.body.append(el);el.focus();el.select();el.setSelectionRange(0,copyText.length);let ok=false;try{ok=document.execCommand('copy');}catch{}el.remove();return ok;}
}
$('copy').addEventListener('click',async()=>{
 $('copy').disabled=true;
 const ok=await copyAccount();
 $('status').textContent=ok?`계좌와 ${amountText}이 함께 복사됐어요.`:'자동 복사가 안 되면 아래 문구를 길게 눌러 복사해 주세요.';
 $('copy-label').textContent=ok?'복사 완료 · 다시 복사':'계좌 · 금액 다시 복사';
 $('copy').disabled=false;
});
document.addEventListener('dragstart',event=>event.preventDefault());
