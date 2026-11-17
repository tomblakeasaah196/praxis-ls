"use strict";
/**
 * The public intake's shapes. The QUOTE shape is `@praxis/shared`'s
 * (quoteRequest.publicQuote, meeting 6 PR 2) — one definition of a quote
 * request for the website, the portal and the desk, with the service id, the
 * hinterland direction and up to three documents. The contact shape has never
 * been shared and stays here, which is why client/scripts/check-schemas.mjs
 * lists this file as partly migrated.
 */
const {z}=require("zod");const {quoteRequest}=require("@praxis/shared");const {AppError}=require("../../../utils/errors");const trap={website_url:z.string().max(0).optional(),form_started_at:z.number().int().optional()};const email=z.string().email().max(255);const schemas={quote:quoteRequest.publicQuote,contact:z.object({...trap,name:z.string().max(255).optional(),email:email.optional(),phone:z.string().max(60).optional(),company_name:z.string().max(255).optional(),subject:z.string().max(255).optional(),message:z.string().min(1).max(20000),enquiry_type:z.enum(["GENERAL_ENQUIRY","PARTNERSHIP","CAREERS","MEDIA"]).optional()}).strict()};const mw=k=>(req,_res,next)=>{const p=schemas[k].safeParse(req.body);if(!p.success)return next(new AppError("VALIDATION_ERROR","Invalid submission",422,p.error.flatten().fieldErrors));if(p.data.form_started_at&&Date.now()-p.data.form_started_at<1500)return next(new AppError("SPAM_REJECTED","Submission rejected",422));delete p.data.website_url;delete p.data.form_started_at;req.body=p.data;next();};module.exports={schemas,quote:mw("quote"),contact:mw("contact")};
