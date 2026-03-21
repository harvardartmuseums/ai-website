module.exports = [
      {
        date_of_change: "2025-12-31",
        service: "Clarifai",
        summary: "Clarifai Legacy Models Decommissioning on December 31",
        details: `See https://docs.clarifai.com/product-updates/upcoming-api-changes/decommission-legacy-models/`
      },
      {
        date_of_change: "2026-01-30",
        service: "AWS",
        summary: "Bedrock Model Deprecation Notice – Claude 3 Opus 'anthropic.claude-3-opus-20240229-v1:0'",
        details: `Hello,

We are contacting you because you have used the following model ID 'anthropic.claude-3-opus-20240229-v1:0' [1] on Amazon Bedrock in the past 30 days.

This is the final notice that on January 30, 2026, the model will reach end-of-life [2] and will no longer be accessible in Amazon Bedrock.

We recommend migrating your usage to newer models launched by Anthropic or another model on Amazon Bedrock by updating your application code [3].

If you have any questions, please reach out to AWS support [4].

[1] https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html
[2] https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html#versions-for-legacy
[3] https://docs.aws.amazon.com/bedrock/latest/APIReference/welcome.html
[4] https://aws.amazon.com/support`
      },
      {
        date_of_change: "2026-03-31",
        service: "Azure",
        summary: "Azure OpenAI gpt-4o model version(s) 2024-05-13 and 2024-08-06 retired",
        details: `Azure OpenAI gpt-4o model version(s) 2024-05-13 and 2024-08-06 will be retired 31 March 2026

On 31 March 2026, Azure OpenAI gpt-4o model version(s) 2024-05-13 and 2024-08-06 will be retired.

As part of this retirement, the replacement model will be set to gpt-5.1 version 2025-11-13 on 9 March 2026. If you've selected the option to auto upgrade your standard, data-zone standard, or global standard deployment(s), they will be automatically upgraded to the replacement model version during the weeks prior to retirement. Learn more about setting your deployment upgrade options.

After the retirement date, model gpt-4o version(s) 2024-05-13 and 2024-08-06 will no longer be available or operable. This retirement will only timpact base-model deployments.

Beginning on 31 March 2026, fine-tuning on model gpt-4o version(s) 2024-05-13 and 2024-08-06 will no longer be allowed. Existing fine-tuned deployments will continue to operate for an additional year.`
      },
      {
        date_of_change: "2026-04-28",
        service: "AWS",
        summary: "Bedrock Model Deprecation Notice – Claude 3.7 Sonnet 'anthropic.claude-3-7-sonnet-20250219-v1:0'",
        details: `Hello,

We are contacting you because you have used model ID anthropic.claude-3-7-sonnet-20250219-v1:0 [1] on Amazon Bedrock in the past 30 days. Effective immediately, by moving Claude 3.7 Sonnet into the Legacy state [2], Anthropic is initiating the deprecation process for this model in the applicable Regions provided later in this message. Once the model enters the Legacy state, no additional Service Quota increases will be granted in the applicable Regions for the model. Claude 3.7 Sonnet will stay in the Legacy state until January 27, 2026, when the model will enter the Extended Access state. On April 28, 2026, the model will go end-of-life and will no longer be accessible from any of the following applicable regions.

Applicable Regions:
US-EAST-1
US-EAST-2
US-WEST-2
AP-NORTHEAST-1
AP-NORTHEAST-2
AP-NORTHEAST-3
AP-SOUTH-1
AP-SOUTH-2
AP-SOUTHEAST-1
AP-SOUTHEAST-2
EU-CENTRAL-1
EU-NORTH-1
EU-WEST-1
EU-WEST-3

Important dates:
- January 27, 2026: Extended access will begin.
- April 28, 2026: This model will no longer be available for use and requests made to this model ID will fail.

We recommend migrating your usage to the Claude Sonnet 4.5 from Anthropic [1] by updating your application code [3]. You can request an increase to your Claude Sonnet 4.5 quotas through Service Quotas [4].

If you have any questions or concerns, please reach out to AWS Support [5].

[1] https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html
[2] https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html#versions-for-legacy
[3] https://docs.aws.amazon.com/bedrock/latest/APIReference/welcome.html
[4] https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-increase.html
[5] https://aws.amazon.com/support`
      },
      {
        date_of_change: "2026-05-19",
        service: "AWS",
        summary: "Bedrock Model Deprecation Notice – Command R+",
        details: `Hello,
        
We are contacting you because you have used model ID cohere.command-r-plus-v1:0 [1] on Amazon Bedrock in the past 30 days. Cohere will be sunsetting this model as of May 19, 2026.

Effective February 19, 2026, we are moving Command R+ into the Legacy state [2] in all AWS Regions. Once the model enters the Legacy state, no additional Service Quota increases will be granted for the model. For customers that need more time to migrate beyond May 19, 2026, Cohere is offering extended access with premium pricing until August 19, 2026. The model will no longer be available on Amazon Bedrock after August 19, 2026, in any AWS Region.

Important dates:
February 19, 2026: Legacy state begins
May 19, 2026: Model sunset date; extended access available with premium pricing
August 19, 2026: This model will no longer be available for use and requests made to this model ID will fail

Updated Pricing for On Demand Inference (Effective May 19, 2026):
Input tokens: $0.006 per 1,000 tokens
Output tokens: $0.03 per 1,000 tokens

Please note: If you have an existing private pricing agreement with Cohere or use provisioned throughput, your current pricing terms will continue to apply.

We recommend migrating your usage to alternative models [1] available on Amazon Bedrock, such as Anthropic Claude Sonnet 4.5, Amazon Nova Pro, or Mistral Large 3 by updating your application code [3]. You can request an increase to your quotas for these models through Service Quotas [4].

[1] https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html
[2] https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html
[3] https://docs.aws.amazon.com/bedrock/latest/APIReference/welcome.html
[4] https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-increase.html
[5] https://aws.amazon.com/support`
      },   
      {
        date_of_change: "2026-09-10",
        service: "AWS",
        summary: "Bedrock Model Deprecation Notice – Claude 3 Haiku 'anthropic.claude-3-haiku-20240307-v1:0'",
        details: `Hello,

[AWS Health may periodically trigger reminder notifications about this communication if resources remain unresolved.]

We are contacting you because you have used the following model ID anthropic.claude-3-haiku-20240307-v1:0 [1] on Amazon Bedrock in the past 30 days.

Effective immediately, by moving Claude 3 Haiku into the Legacy state [2], Anthropic is initiating the deprecation process for this model in the following Regions: ap-northeast-1, ap-southeast-2, eu-central-1, eu-west-1, eu-west-2, eu-west-3, us-east-1, us-west-2, us-east-2. Once the model enters the Legacy state, no additional Service Quota increases will be granted for the model. Claude 3 Haiku will stay in the Legacy state until June 10, 2026, when the model will enter the Extended Access state. On September 10, 2026, the model will go end-of-life and will no longer be accessible in Amazon Bedrock.

Important dates:
- March 10, 2026: Legacy state begins
- June 10, 2026: Extended access begins
- September 10, 2026: This model will no longer be available for use and requests made to this model ID will fail

We recommend migrating your usage to the the latest Anthropic models [1] by updating your application code [3]. You can request an increase to your new model quotas through Service Quotas [4].

If you have any questions or concerns, please contact AWS Support [5].

[1] https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html
[2] https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html#versions-for-legacy
[3] https://docs.aws.amazon.com/bedrock/latest/APIReference/welcome.html
[4] https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-increase.html
[5] https://aws.amazon.com/support
`
      }       
];